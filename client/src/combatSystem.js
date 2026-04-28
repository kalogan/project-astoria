// combatSystem.js — auto-attack engine with Astonia-style skill integration.
//
// ── AUTO-ATTACK PIPELINE ──────────────────────────────────────────────────────
//   1. Player clicks  →  attackReady = true
//   2. update():  if cooldown expired AND attackReady  →  _attack()
//   3. _attack():
//      a. Find target (nearest enemy in ATTACK_RANGE)
//      b. Compute damage from build.getWeaponDamage()   ← skill-driven
//      c. Roll crit
//      d. Apply damage to target
//      e. If player.surroundHitActive → also sweep all enemies in getSurroundRadius()
//      f. Emit enemy_damaged + enemy_killed events
//   4. Cooldown = build.getAttackSpeed()    ← skill + AGI driven
//
// ── SURROUND HIT MODIFIER ─────────────────────────────────────────────────────
//   Toggled by the surround_hit ability in abilitySystem.
//   When active, the same attack swing also damages nearby enemies.
//   No separate event — piggybacked on auto-attack (design rule from spec).
//   Damage per extra target = weaponDamage × getSurroundDamageMult() (< 1.0 at low skill).
//
// ── ARMOR REDUCTION ───────────────────────────────────────────────────────────
//   Incoming damage is reduced by build.getArmorReduction() in main.js
//   (inside the player_damaged handler), not here — keeps concerns separate.

import * as THREE from 'three';

const ATTACK_RANGE    = 2.5;
const ATTACK_DAMAGE   = 34;    // legacy fallback when no build is present
const FLASH_DURATION  = 0.08;
const LOOT_PICKUP_SQ  = 1.0;

class Loot {
  constructor(scene, x, z) {
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, 0.4, z);
    this.collected = false;
    scene.add(this.mesh);
  }

  collect() {
    this.collected = true;
    this.mesh.visible = false;
  }
}

export class CombatSystem {
  constructor(scene, player, { hud, eventBus } = {}) {
    this.scene       = scene;
    this.player      = player;
    this.hud         = hud      ?? null;
    this.eventBus    = eventBus ?? null;
    this.build       = null;   // set externally from main.js
    this.registry    = null;
    this.cooldown    = 0;
    this.loot        = [];
    this.flashing    = [];
    this.attackReady = false;
    this._debug      = false;

    window.addEventListener('click', () => { this.attackReady = true; });
  }

  init(_zone, registry, eventBus, rng = null) {
    this.registry = registry;
    this.eventBus = eventBus ?? this.eventBus;
    this.rng      = rng;
    this.flashing = [];
  }

  update(delta) {
    // Tick attack cooldown
    this.cooldown = Math.max(0, this.cooldown - delta);

    if (this.attackReady) {
      this.attackReady = false;
      if (this.cooldown === 0) {
        this._attack();
        // Attack speed from skills: lower = faster
        const atkSpeed = this.build?.getAttackSpeed() ?? 0.4;
        this.cooldown  = atkSpeed;
        if (this._debug) console.log(`[Combat] swing  cooldown=${atkSpeed.toFixed(3)}s`);
      }
    }

    // Flash white on hit, then restore enemy colour
    for (let i = this.flashing.length - 1; i >= 0; i--) {
      const f = this.flashing[i];
      f.timer -= delta;
      if (f.timer <= 0) {
        if (f.enemy.alive) f.enemy.mat.color.setHex(f.enemy.color);
        this.flashing.splice(i, 1);
      }
    }

    // Loot pickup radius
    const pp = this.player.mesh.position;
    for (const l of this.loot) {
      if (l.collected) continue;
      const dx = pp.x - l.mesh.position.x;
      const dz = pp.z - l.mesh.position.z;
      if (dx * dx + dz * dz <= LOOT_PICKUP_SQ) {
        l.collect();
        this.eventBus?.emit('loot_collected', {
          x: l.mesh.position.x, z: l.mesh.position.z,
        });
      }
    }
  }

  onEvent(_event) {}

  clearLoot(scene) {
    for (const l of this.loot) scene.remove(l.mesh);
    this.loot = [];
  }

  loadLoot(items) {
    for (const item of items) {
      const l = new Loot(this.scene, item.x, item.z);
      if (item.collected) l.collect();
      this.loot.push(l);
    }
  }

  // ── Attack logic ───────────────────────────────────────────────────────────

  _attack() {
    if (!this.registry) return;

    const pp = this.player.mesh.position;

    // ── Primary target: nearest in range ─────────────────────────────────
    let target   = null;
    let bestDist = Infinity;

    for (const enemy of this.registry.getEntitiesByType('enemy')) {
      if (!enemy.alive) continue;
      const dx   = enemy.mesh.position.x - pp.x;
      const dz   = enemy.mesh.position.z - pp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= ATTACK_RANGE && dist < bestDist) {
        target   = enemy;
        bestDist = dist;
      }
    }

    if (!target) return;

    // Signal animation + audio
    this.eventBus?.emit('attack_started', { source: 'auto', entityId: 'player' });

    // ── Damage calculation (skill-driven) ──────────────────────────────────
    // Primary source: build.getWeaponDamage() which reads sword/attack/tactics skills.
    // Fallback (no build): legacy flat damage.
    const baseDamage = this.build
      ? this.build.getWeaponDamage()
      : Math.floor(ATTACK_DAMAGE * (1 + ((this.player.level ?? 1) - 1) * 0.05));

    const critChance = this.build?.getCritChance() ?? 0;
    const isCrit     = (this.rng?.nextFloat(0, 1) ?? Math.random()) < critChance;
    const critMult   = this.build?.getCritMultiplier() ?? 1.5;

    let primaryDmg = isCrit ? Math.round(baseDamage * critMult) : baseDamage;

    if (this._debug) {
      console.log(`[Combat] auto-attack  base=${baseDamage}  crit=${isCrit}  final=${primaryDmg}`);
    }

    const dead = target.takeDamage(primaryDmg);
    this.eventBus?.emit('enemy_damaged', {
      enemyId:   target.id,
      amount:    primaryDmg,
      remaining: target.hp,
      isCrit,
      position:  { x: target.mesh.position.x, y: target.mesh.position.y, z: target.mesh.position.z },
    });

    if (dead) {
      this._spawnLoot(target);
      this.eventBus?.emit('enemy_killed', {
        enemyId: target.id,
        xpValue: target.xpValue ?? 10,
        x:       target.mesh.position.x,
        z:       target.mesh.position.z,
      });
    } else {
      this._flash(target);
    }

    // ── Surround Hit sweep ─────────────────────────────────────────────────
    // When player.surroundHitActive is true, also damage all nearby enemies.
    // This is a MODIFIER on auto-attack — no separate event, same timing.
    if (this.player.surroundHitActive) {
      const r         = this.build?.getSurroundRadius()     ?? 2.5;
      const dmgMult   = this.build?.getSurroundDamageMult() ?? 0.85;
      const r2        = r * r;
      let   sweepHits = 0;

      for (const e of this.registry.getEntitiesByType('enemy')) {
        if (!e.alive)      continue;
        if (e === target)  continue; // already hit above
        const dx = e.mesh.position.x - pp.x;
        const dz = e.mesh.position.z - pp.z;
        if (dx * dx + dz * dz > r2) continue;

        const sweepDmg = Math.floor(baseDamage * dmgMult);
        const sweepDead = e.takeDamage(sweepDmg);
        this.eventBus?.emit('enemy_damaged', {
          enemyId:   e.id,
          amount:    sweepDmg,
          remaining: e.hp,
          isCrit:    false,
          position:  { x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z },
        });
        if (sweepDead) {
          this._spawnLoot(e);
          this.eventBus?.emit('enemy_killed', {
            enemyId: e.id, xpValue: e.xpValue ?? 10,
            x: e.mesh.position.x, z: e.mesh.position.z,
          });
        } else {
          this._flash(e);
        }
        sweepHits++;
      }

      if (this._debug && sweepHits > 0) {
        console.log(`[Combat] surroundHit swept ${sweepHits} extra targets  r=${r.toFixed(1)}  dmgMult=${dmgMult.toFixed(2)}`);
      }
    }
  }

  _spawnLoot(target) {
    const scatter = this.rng ? this.rng.nextFloat(-0.3, 0.3) : 0;
    this.loot.push(new Loot(
      this.scene,
      target.mesh.position.x + scatter,
      target.mesh.position.z + scatter,
    ));
  }

  _flash(enemy) {
    enemy.mat.color.setHex(0xffffff);
    this.flashing.push({ enemy, timer: FLASH_DURATION });
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setDebug(on = true) { this._debug = on; }

  inspect() {
    const weaponDmg  = this.build?.getWeaponDamage()  ?? ATTACK_DAMAGE;
    const atkSpeed   = this.build?.getAttackSpeed()   ?? 0.4;
    const armorRed   = this.build?.getArmorReduction() ?? 0;
    const surroundOn = this.player?.surroundHitActive ?? false;
    console.log(
      `[Combat] weapon=${weaponDmg}  speed=${atkSpeed.toFixed(3)}s  ` +
      `armor=${(armorRed * 100).toFixed(0)}%  surround=${surroundOn}`,
    );
  }
}
