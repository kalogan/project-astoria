// enemyTelegraphSystem.js — pre-ability wind-up visuals for enemies.
//
// When enemy_ability_pending fires, this system draws a ground indicator
// beneath the enemy for the full telegraph window.  The indicator shrinks
// from full size to nothing as the timer counts down, giving the player a
// clear reaction window.
//
// Visual types (chosen per abilityId):
//   ring    — flat torus on the floor (default)  — e.g. melee attacks
//   cone    — thin triangle fan pointing forward — e.g. cleave
//   circle  — flat disc expanding outward        — e.g. nova / roar
//
// Color mapping:
//   attack-class abilities → 0xff4400 (orange-red)
//   cast-class abilities   → 0xcc44ff (violet)
//   default                → 0xffcc00 (amber)
//
// The indicator tracks entity position every frame.
// On enemy_ability_execute OR enemy_killed the indicator is removed.
//
// Interruptibility: if the enemy is stunned mid-telegraph the indicator
// is also cleared (checked each update frame).
//
// PERFORMANCE
//   At most one active telegraph per enemy at any time.
//   Geometry is created on demand and disposed on removal (not pooled —
//   telegraphs are rare enough that GC pressure is negligible).

import * as THREE from 'three';

// ── Visual config per abilityId ───────────────────────────────────────────────

const VISUAL_MAP = {
  // melee / physical
  slam:         { type: 'ring',   color: 0xff4400, scale: 1.4 },
  stun_strike:  { type: 'ring',   color: 0xff4400, scale: 1.0 },
  weaken_blow:  { type: 'ring',   color: 0xff8800, scale: 1.0 },
  melee_strike: { type: 'ring',   color: 0xff4400, scale: 0.8 },
  boss_cleave:  { type: 'cone',   color: 0xff2200, scale: 2.2 },
  boss_charge:  { type: 'ring',   color: 0xff2200, scale: 1.8 },
  boss_slam_rage:{ type:'ring',   color: 0xff0000, scale: 1.6 },

  // magical / ranged
  enemy_fireball: { type: 'circle', color: 0xff6600, scale: 1.2 },
  enemy_nova:     { type: 'circle', color: 0xff3300, scale: 2.8 },
  boss_roar:      { type: 'circle', color: 0xcc44ff, scale: 3.0 },
};

const DEFAULT_VISUAL = { type: 'ring', color: 0xffcc00, scale: 1.0 };

// ── EnemyTelegraphSystem ──────────────────────────────────────────────────────

export class EnemyTelegraphSystem {
  constructor(scene) {
    this._scene    = scene;
    this._registry = null;
    this._eventBus = null;
    this._enabled  = true;
    this._debug    = false;
    this._bound    = false;

    // enemyId → TelegraphEntry
    // { mesh, timer, duration, enemyId, abilityId, origScale }
    this._active = new Map();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setContext({ scene }) {
    this._scene = scene ?? this._scene;
  }

  init(_zone, registry, eventBus) {
    this._registry = registry;
    this._eventBus = eventBus;
    this._clearAll();
    if (!this._bound) {
      this._bindEvents();
      this._bound = true;
    }
  }

  onEvent() {}

  update(delta) {
    if (!this._enabled) return;

    for (const [enemyId, entry] of this._active) {
      const enemy = this._registry?.getEntityById(enemyId);

      // Interrupt if enemy is now stunned or dead
      if (!enemy || enemy._dead || enemy._stunned) {
        this._removeTelegraph(enemyId);
        continue;
      }

      // Track enemy position (ground level)
      if (enemy.mesh) {
        entry.mesh.position.x = enemy.mesh.position.x;
        entry.mesh.position.z = enemy.mesh.position.z;
      }

      // Count down
      entry.timer -= delta * 1000;
      const frac = Math.max(0, entry.timer / entry.duration);  // 1→0

      // Scale + opacity shrink as timer approaches 0
      const s = frac * entry.origScale;
      entry.mesh.scale.set(s, 1, s);
      if (entry.mesh.material) entry.mesh.material.opacity = 0.25 + frac * 0.45;

      if (entry.timer <= 0) {
        this._removeTelegraph(enemyId);
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _bindEvents() {
    const eb = this._eventBus;
    if (!eb) return;

    eb.on('enemy_ability_pending', ({ payload }) => {
      if (!this._enabled) return;
      const { enemyId, abilityId, telegraphMs, position } = payload ?? {};
      if (!enemyId || !telegraphMs) return;
      this._spawnTelegraph(enemyId, abilityId, telegraphMs, position);
    });

    eb.on('enemy_ability_execute', ({ payload }) => {
      if (payload?.enemyId) this._removeTelegraph(payload.enemyId);
    });

    eb.on('enemy_killed', ({ payload }) => {
      const id = payload?.enemyId ?? payload?.id;
      if (id) this._removeTelegraph(id);
    });
  }

  _spawnTelegraph(enemyId, abilityId, telegraphMs, position) {
    // Clear any existing telegraph for this enemy
    if (this._active.has(enemyId)) this._removeTelegraph(enemyId);

    const vis   = VISUAL_MAP[abilityId] ?? DEFAULT_VISUAL;
    const scene = this._scene;
    if (!scene) return;

    const mat = new THREE.MeshBasicMaterial({
      color:       vis.color,
      transparent: true,
      opacity:     0.65,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    });

    let geo;
    switch (vis.type) {
      case 'cone':
        geo = new THREE.ConeGeometry(vis.scale * 0.5, vis.scale, 3, 1, true);
        break;
      case 'circle':
        geo = new THREE.CircleGeometry(vis.scale * 0.5, 24);
        break;
      default:  // ring
        geo = new THREE.TorusGeometry(vis.scale * 0.4, 0.07, 4, 28);
    }

    const mesh = new THREE.Mesh(geo, mat);

    // Lay flat on the ground (XZ plane)
    if (vis.type === 'ring' || vis.type === 'circle') {
      mesh.rotation.x = -Math.PI / 2;
    } else {
      // cone points forward — tilt to lie on ground and rotate with enemy facing
      mesh.rotation.z = -Math.PI / 2;
    }

    const pos = position ?? { x: 0, y: 0, z: 0 };
    mesh.position.set(pos.x ?? 0, 0.02, pos.z ?? 0);  // just above ground

    scene.add(mesh);

    this._active.set(enemyId, {
      mesh,
      geo,
      mat,
      timer:     telegraphMs,
      duration:  telegraphMs,
      origScale: vis.scale,
      abilityId,
    });

    if (this._debug) console.log(`[Telegraph] spawn "${abilityId}" for "${enemyId}" (${telegraphMs}ms)`);
  }

  _removeTelegraph(enemyId) {
    const entry = this._active.get(enemyId);
    if (!entry) return;
    this._scene?.remove(entry.mesh);
    entry.geo?.dispose();
    entry.mat?.dispose();
    this._active.delete(enemyId);
    if (this._debug) console.log(`[Telegraph] removed for "${enemyId}"`);
  }

  _clearAll() {
    for (const [id] of this._active) this._removeTelegraph(id);
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setEnabled(on = true) { this._enabled = on; }
  toggle()              { this._enabled = !this._enabled; }
  setDebug(on = true)   { this._debug = on; }

  inspect() {
    if (!this._active.size) { console.log('[Telegraph] No active telegraphs'); return; }
    for (const [id, e] of this._active) {
      console.log(`  "${id}": "${e.abilityId}" ${e.timer.toFixed(0)}ms remaining`);
    }
  }

  /** Manually test a telegraph: __debug.telegraph.test('enemyId', 'slam') */
  test(enemyId, abilityId = 'slam', ms = 600) {
    const enemy = this._registry?.getEntityById(enemyId);
    const pos   = enemy?.mesh?.position ?? { x: 0, y: 0, z: 0 };
    this._spawnTelegraph(enemyId, abilityId, ms, pos);
    console.log(`[Telegraph] testing "${abilityId}" on "${enemyId}" for ${ms}ms`);
  }
}
