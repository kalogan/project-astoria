// projectileSystem.js — pooled, event-driven projectile manager.
//
// Handles all projectile-type mage abilities:
//   fireball       — medium speed (10 u/s), explodes in small radius on impact
//   lightning_ball — very fast   (22 u/s), single-target hit, no explosion
//   magic_missile  — fast        (16 u/s), single-target hit, no explosion
//
// ── DESIGN RULES ─────────────────────────────────────────────────────────────
//   • Pool of POOL_SIZE meshes — zero GC per frame during gameplay.
//   • Direction: caller passes a normalized {x, z} aim vector.
//     Falls back to last player move direction if no cursor data.
//   • Flight height: fixed Y = FLIGHT_Y (projectile doesn't arc).
//   • Collision: projectile sphere radius vs enemy center (simple, fast).
//   • Explosion: when explosionRadius > 0, damages all enemies in that radius.
//   • TTL: auto-expire after MAX_TTL seconds — no infinite travel.
//   • pierce: optional flag; projectile passes through enemies (no explosion support).
//
// ── INTEGRATION ──────────────────────────────────────────────────────────────
//   Called by abilitySystem via the context.spawnProjectile() helper.
//   Emits: enemy_damaged, enemy_killed

import * as THREE from 'three';

const POOL_SIZE      = 16;
const MAX_TTL        = 6.0;   // seconds — auto-expire if nothing hit
const FLIGHT_Y       = 1.0;   // world-space height projectiles travel at
const COLL_RADIUS    = 0.55;  // enemy hit-sphere radius (half enemy width ≈ 0.3 + margin)
const COLL_RADIUS_SQ = COLL_RADIUS * COLL_RADIUS;

// Visual config per ability
// arcRadius: if > 0, projectile zaps nearby enemies while travelling (lightning_bolt)
// arcDamageFrac: arc damage = main damage * this fraction (default 0.5)
// arcMaxPerTick: max simultaneous arc targets per update tick
// arcCooldown: seconds between hits on the SAME enemy via arcing
const PROJ_CONFIG = {
  fireball:       { color: 0xff4400, size: 0.24, speed: 10,  explosionRadius: 2.4, pierce: false, arcRadius: 0 },
  lightning_ball: { color: 0x88eeff, size: 0.18, speed: 22,  explosionRadius: 0,   pierce: false, arcRadius: 0 },
  magic_missile:  { color: 0xb39ddb, size: 0.15, speed: 16,  explosionRadius: 0,   pierce: false, arcRadius: 0 },
  lightning_bolt: { color: 0x44ddff, size: 0.20, speed: 13,  explosionRadius: 0,   pierce: false,
                    arcRadius: 2.2, arcDamageFrac: 0.55, arcMaxPerTick: 2, arcCooldown: 0.22 },
};

const DEFAULT_CONFIG = { color: 0xffffff, size: 0.18, speed: 14, explosionRadius: 0, pierce: false, arcRadius: 0 };

export class ProjectileSystem {
  constructor(scene) {
    this._scene    = scene;
    this._registry = null;
    this._eventBus = null;
    this._player   = null;
    this._enabled  = true;
    this._debug    = false;
    this._bound    = false;

    // Pool: each slot holds { mesh, mat, active, ...state }
    this._pool = [];
    this._initPool(scene);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setContext({ scene, player }) {
    this._scene  = scene ?? this._scene;
    this._player = player;
  }

  init(_zone, registry, eventBus) {
    this._registry = registry;
    this._eventBus = eventBus;
    // Deactivate all in-flight projectiles between zones
    for (const p of this._pool) this._release(p);
  }

  onEvent() {}

  update(delta) {
    if (!this._enabled) return;

    for (const p of this._pool) {
      if (!p.active) continue;

      // Move
      p.mesh.position.x += p.dx * p.speed * delta;
      p.mesh.position.z += p.dz * p.speed * delta;

      // Slight visual spin
      p.mesh.rotation.y += delta * 4.0;

      // TTL
      p.ttl -= delta;
      if (p.ttl <= 0) { this._release(p); continue; }

      // ── Arc damage (lightning_bolt) ────────────────────────────────────
      // While projectile is in flight, zap nearby enemies it passes close to.
      // A per-enemy cooldown prevents the same enemy being zapped every frame.
      if (p.arcRadius > 0) {
        const r2 = p.arcRadius * p.arcRadius;
        let arcsThisTick = 0;

        // Tick arc cooldowns
        for (const [id, cd] of p.arcCooldowns) {
          const next = cd - delta;
          if (next <= 0) p.arcCooldowns.delete(id);
          else           p.arcCooldowns.set(id, next);
        }

        for (const e of this._registry?.getEntitiesByType('enemy') ?? []) {
          if (!e.alive) continue;
          if (arcsThisTick >= p.arcMaxPerTick) break;
          if (p.arcCooldowns.has(e.id)) continue;
          const ex = e.mesh.position.x - p.mesh.position.x;
          const ez = e.mesh.position.z - p.mesh.position.z;
          if (ex * ex + ez * ez > r2) continue;

          const arcDmg = Math.max(1, Math.floor(p.damage * p.arcDamageFrac));
          this._hitSingle(p, e, arcDmg, true /* isArc */);
          p.arcCooldowns.set(e.id, p.arcCooldown);
          arcsThisTick++;
        }
      }

      // ── Direct collision ───────────────────────────────────────────────
      for (const e of this._registry?.getEntitiesByType('enemy') ?? []) {
        if (!e.alive) continue;
        const ex  = e.mesh.position.x - p.mesh.position.x;
        const ez  = e.mesh.position.z - p.mesh.position.z;
        const d2  = ex * ex + ez * ez;
        if (d2 > COLL_RADIUS_SQ) continue;

        // Direct hit
        if (p.explosionRadius > 0) {
          this._explode(p, e.mesh.position);
        } else {
          this._hitSingle(p, e, p.damage, false);
        }
        if (!p.pierce) { this._release(p); break; }
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Spawn a projectile.
   * @param {string} abilityId  — key in PROJ_CONFIG
   * @param {{ x:number, z:number }} origin   — world position of caster
   * @param {{ x:number, z:number }} aimDir   — normalized direction
   * @param {number} damage     — pre-computed damage value
   */
  spawn(abilityId, origin, aimDir, damage) {
    if (!this._enabled) return;
    const cfg = PROJ_CONFIG[abilityId] ?? DEFAULT_CONFIG;
    const p   = this._acquire();
    if (!p) { if (this._debug) console.warn('[Proj] pool exhausted'); return; }

    p.active          = true;
    p.abilityId       = abilityId;
    p.damage          = damage;
    p.speed           = cfg.speed;
    p.dx              = aimDir.x;
    p.dz              = aimDir.z;
    p.explosionRadius = cfg.explosionRadius;
    p.pierce          = cfg.pierce;
    p.ttl             = MAX_TTL;
    // Arc state (lightning_bolt)
    p.arcRadius       = cfg.arcRadius       ?? 0;
    p.arcDamageFrac   = cfg.arcDamageFrac   ?? 0.5;
    p.arcMaxPerTick   = cfg.arcMaxPerTick   ?? 2;
    p.arcCooldown     = cfg.arcCooldown     ?? 0.22;
    p.arcCooldowns.clear();

    p.mesh.position.set(origin.x, FLIGHT_Y, origin.z);
    p.mesh.scale.setScalar(cfg.size / 0.18);  // normalize to base size
    p.mat.color.setHex(cfg.color);
    p.mat.opacity    = 0.92;
    p.mesh.visible   = true;

    if (this._debug) console.log(`[Proj] spawn "${abilityId}"  dir=(${aimDir.x.toFixed(2)}, ${aimDir.z.toFixed(2)})  dmg=${damage}`);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _initPool(scene) {
    if (!scene) return;
    const geo = new THREE.SphereGeometry(0.18, 6, 6);
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat  = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this._pool.push({
        mesh, mat,
        active: false,
        abilityId: '', damage: 0,
        dx: 0, dz: 0, speed: 14,
        explosionRadius: 0, pierce: false,
        ttl: 0,
        // Arc state — reused across spawns, cleared in spawn()
        arcRadius: 0, arcDamageFrac: 0.5, arcMaxPerTick: 2, arcCooldown: 0.22,
        arcCooldowns: new Map(),
      });
    }
  }

  _acquire() {
    return this._pool.find(p => !p.active) ?? null;
  }

  _release(p) {
    p.active       = false;
    p.mesh.visible = false;
  }

  _hitSingle(p, enemy, damage = p.damage, isArc = false) {
    const dead = enemy.takeDamage(damage);
    this._eventBus?.emit('enemy_damaged', {
      enemyId:  enemy.id,
      amount:   damage,
      isCrit:   false,
      position: { x: enemy.mesh.position.x, y: enemy.mesh.position.y, z: enemy.mesh.position.z },
    });
    if (dead) this._eventBus?.emit('enemy_killed', _killPayload(enemy));
    if (this._debug) console.log(`[Proj] "${p.abilityId}" ${isArc ? 'arc→' : 'hit '} "${enemy.id}" dmg=${damage}`);
  }

  _explode(p, impactPos) {
    const r2 = p.explosionRadius * p.explosionRadius;
    let hits = 0;
    for (const e of this._registry?.getEntitiesByType('enemy') ?? []) {
      if (!e.alive) continue;
      const dx = e.mesh.position.x - impactPos.x;
      const dz = e.mesh.position.z - impactPos.z;
      if (dx * dx + dz * dz > r2) continue;
      const dead = e.takeDamage(p.damage);
      this._eventBus?.emit('enemy_damaged', {
        enemyId:  e.id,
        amount:   p.damage,
        isCrit:   false,
        position: { x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z },
      });
      if (dead) this._eventBus?.emit('enemy_killed', _killPayload(e));
      hits++;
    }
    // Emit an explosion visual event (abilityEffectSystem can handle 'fireball' on this)
    this._eventBus?.emit('projectile_exploded', {
      abilityId: p.abilityId,
      position:  impactPos,
      radius:    p.explosionRadius,
      hits,
    });
    if (this._debug) console.log(`[Proj] "${p.abilityId}" exploded at (${impactPos.x.toFixed(1)},${impactPos.z.toFixed(1)})  hits=${hits}`);
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setEnabled(on = true) { this._enabled = on; }
  setDebug(on = true)   { this._debug = on; }

  inspect() {
    const active = this._pool.filter(p => p.active);
    console.log(`[Proj] ${active.length}/${POOL_SIZE} active`);
    for (const p of active) {
      console.log(`  "${p.abilityId}"  ttl=${p.ttl.toFixed(1)}s  dmg=${p.damage}`);
    }
  }

  /**
   * Manually spawn a test projectile from the player.
   * __debug.proj.test('fireball')
   */
  test(abilityId = 'fireball') {
    if (!this._player) { console.warn('[Proj] no player in context'); return; }
    const origin = { x: this._player.mesh.position.x, z: this._player.mesh.position.z };
    this.spawn(abilityId, origin, { x: 0, z: -1 }, 50);
    console.log(`[Proj] test spawn "${abilityId}" heading north`);
  }
}

function _killPayload(e) {
  return {
    enemyId:  e.id,
    id:       e.id,
    xpValue:  e.xpValue ?? 10,
    x:        e.mesh.position.x,
    z:        e.mesh.position.z,
    position: e.mesh.position,
  };
}
