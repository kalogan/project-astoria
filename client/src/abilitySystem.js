// abilitySystem.js — active ability slots, cooldowns, and behavior dispatch.
//
// ── WARRIOR DESIGN (ASTONIA-ACCURATE) ────────────────────────────────────────
//   Warrior is NOT ability-heavy. Core gameplay is auto-attack + combat modifiers.
//
//   SLOT 0 — Surround Hit (toggle)
//     Activates/deactivates a modifier that makes every auto-attack also sweep
//     nearby enemies. Implemented as a boolean on player.surroundHitActive.
//     CombatSystem reads this flag on each swing.
//
//   SLOT 1 — Warcry
//     Instant AoE burst + stun. Uses warcry skill for scaling (not raw STR).
//
//   No "charge", no multiple attack buttons.
//   Power comes from sword/attack/tactics SKILLS, not ability spam.
//
// ── MAGE DESIGN (SKILL-DRIVEN) ────────────────────────────────────────────────
//   All spell damage routes through build.getSpellDamage(skillId, scalar).
//   Scalar constants below are the ONLY tuning knobs.
//   skill values come from build._classSkills (trainable) × stat multipliers.
//
//   fire     → fireball explosion      (scalar FIRE_SCALAR)
//   lightning → lightning_ball, bolt   (scalar LBALL_SCALAR, LBOLT_SCALAR)
//   pulse    → lightning_pulse         (scalar PULSE_SCALAR)
//   —         magic_missile spammable  (lightning × MISSILE_SCALAR)
//   magicShield → shield value from build.getMagicShieldStats()
//
// ── SLOT LAYOUT ──────────────────────────────────────────────────────────────
//   Warrior:  2 slots  — 1=surround_hit  2=warcry
//   Rogue:    2 slots  — 1=backstab      2=dash
//   Mage:     5 slots  — 1=fireball  2=lightning_ball  3=lightning_bolt
//                        4=lightning_pulse  5=magic_shield

import * as THREE from 'three';

// ── Scalar constants (tune here, nowhere else) ─────────────────────────────
// Warrior (legacy scalars kept for fallback path only)
const W_STR_PER_WARCRY  = 3.2;   // fallback only; warcry now reads warcry skill

// Mage: damage = build.getSpellDamage(skillId, SCALAR)
const FIRE_SCALAR    = 1.60;  // fireball per-enemy in explosion radius
const LBALL_SCALAR   = 1.80;  // lightning ball direct hit
const LBOLT_SCALAR   = 1.30;  // lightning bolt (direct/arc)
const PULSE_SCALAR   = 0.70;  // lightning pulse (rapid ticks; lower per hit)
const MISSILE_SCALAR = 1.10;  // magic missile spammable bolt

// Mage mana costs — intentionally LOW (spam-friendly)
const MANA_MISSILE  =  3;
const MANA_LBALL    =  5;
const MANA_FIREBALL =  8;
const MANA_LBOLT    =  6;
const MANA_PULSE    = 15;
const MANA_SHIELD   = 12;

// Lightning bolt: cursor distance threshold for orbit vs projectile mode
const LBOLT_AIM_THRESHOLD_SQ = 4.0 * 4.0;

// Parry
const PARRY_DURATION  = 2.0;
const PARRY_REDUCTION = 0.50;

// ── Ability definitions ───────────────────────────────────────────────────────

const ABILITY_DEFS = {

  // ══════════════════════════════════════════════════════════════════════════
  //  WARRIOR
  //  Core: auto-attack (CombatSystem). Abilities are MODIFIERS, not attacks.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Surround Hit (Slot 0, key Q/1) ───────────────────────────────────────
  //
  // DESIGN: This is a TOGGLE modifier — NOT a standalone attack.
  // When active, every auto-attack also sweeps nearby enemies in a radius.
  // CombatSystem handles the actual sweep (piggybacked on auto-attack timing).
  // The ability effect just flips player.surroundHitActive.
  //
  // Radius + damage mult per extra target scale from surroundHit skill.
  //
  surround_hit: {
    id:          'surround_hit',
    name:        'Surround Hit',
    type:        'buff',           // toggle buff — no cooldown between states
    description: 'Toggle — auto attacks sweep nearby enemies. Radius and power from Surround Hit skill.',
    cooldown:    1.5,              // short CD prevents accidental double-tap
    manaCost:    0,
    animation:   'attack',
    sfx:         'ui.click',

    // activeCheck is called every frame by getSlots() to keep HUD in sync
    activeCheck: ({ player }) => player.surroundHitActive ?? false,

    effect({ player, build, eventBus, spawnEffect }) {
      player.surroundHitActive = !(player.surroundHitActive ?? false);

      const radius = build?.getSurroundRadius?.() ?? 2.5;

      if (player.surroundHitActive) {
        // Visual ring to show active radius
        spawnEffect(player.mesh.position, 0xff8844, radius);
        eventBus?.emit('surround_hit_activated', { radius });
        console.log(`[Warrior] Surround Hit ON  radius=${radius.toFixed(1)}`);
      } else {
        eventBus?.emit('surround_hit_deactivated', {});
        console.log('[Warrior] Surround Hit OFF');
      }
      eventBus?.emit('ability_used', { abilityId: 'surround_hit', active: player.surroundHitActive });
    },
  },

  // ── Warcry (Slot 1, key F/2) ──────────────────────────────────────────────
  //
  // Instant AoE battle cry: deals damage and stuns nearby enemies.
  // Scales from warcry CLASS SKILL (build.getComputedSkill('warcry')), not raw STR.
  // Radius and stun duration also scale with skill.
  //
  warcry: {
    id:          'warcry',
    name:        'Warcry',
    type:        'instant_aoe',
    description: 'Instant AoE stun + damage. Scales from Warcry skill.',
    cooldown:    12.0,
    manaCost:    0,
    animation:   'attack',
    sfx:         'combat.attack',
    effect({ player, registry, build, eventBus, spawnEffect, statusFX }) {
      const pp = player.mesh.position;

      // Skill-based values; fall back to STR if build unavailable
      const r       = build?.getWarcryRadius?.()        ?? 3.5;
      const stunDur = build?.getWarcryStuDuration?.()   ?? 1.0;
      const r2      = r * r;

      // Damage: warcrySkill × scalar × dmgMultiplier
      const warcrySkill = build?.getComputedSkill?.('warcry') ?? 8;
      const dmg = Math.floor(
        warcrySkill * W_STR_PER_WARCRY * (build?.getDamageMultiplier() ?? 1)
      );

      let hits = 0;
      for (const e of registry?.getEntitiesByType('enemy') ?? []) {
        if (!e.alive) continue;
        const dx = e.mesh.position.x - pp.x, dz = e.mesh.position.z - pp.z;
        if (dx * dx + dz * dz > r2) continue;

        const dead = e.takeDamage(dmg);
        eventBus?.emit('enemy_damaged', { enemyId: e.id, amount: dmg, isCrit: false, position: e.mesh.position });
        if (dead) eventBus?.emit('enemy_killed', _killPayload(e));

        // Stun via statusEffectSystem
        statusFX?.applyEffect(e.id, 'stun', { duration: stunDur });
        hits++;
      }

      spawnEffect(pp, 0xff8800, r);
      eventBus?.emit('ability_used', { abilityId: 'warcry', hits, stunDur, dmg });
      console.log(`[Warrior] Warcry  hits=${hits}  stun=${stunDur.toFixed(1)}s  dmg=${dmg}  r=${r.toFixed(1)}`);
    },
  },

  // ── War Cry (alias — kept for skill-tree compatibility) ───────────────────
  war_cry: {
    id:          'war_cry',
    name:        'War Cry',
    type:        'instant_aoe',
    description: 'Alias for warcry. Use warcry slot for new builds.',
    cooldown:    12.0,
    manaCost:    0,
    animation:   'attack',
    sfx:         'combat.attack',
    effect(ctx) { ABILITY_DEFS.warcry.effect(ctx); },
  },

  // ── Parry ─────────────────────────────────────────────────────────────────
  parry: {
    id:          'parry',
    name:        'Parry',
    type:        'buff',
    description: `Brace ${PARRY_DURATION}s. Reduces incoming damage ${PARRY_REDUCTION * 100}%.`,
    cooldown:    10.0,
    manaCost:    0,
    animation:   'parry',
    sfx:         'ui.click',
    effect({ player, spawnEffect, eventBus }) {
      player._parryActive = true;
      player._parryTimer  = PARRY_DURATION;
      spawnEffect(player.mesh.position, 0xf39c12, 1.2);
      eventBus?.emit('ability_used',    { abilityId: 'parry' });
      eventBus?.emit('parry_activated', { duration: PARRY_DURATION, reduction: PARRY_REDUCTION });
    },
  },

  // REMOVED from warrior default slots but kept here for skill tree access:
  // charge, slash (old surround-hit standalone attack)

  charge: {
    id:          'charge',
    name:        'Charge',
    type:        'mobility',
    description: 'Rush to nearest enemy and deal heavy damage. Not in default warrior kit.',
    cooldown:    6.0,
    manaCost:    0,
    animation:   'attack',
    sfx:         'combat.attack',
    effect({ player, registry, build, eventBus, spawnEffect }) {
      const pp     = player.mesh.position;
      const target = _nearest(registry, pp, 16);
      if (!target) return;
      const dx   = target.mesh.position.x - pp.x;
      const dz   = target.mesh.position.z - pp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const nx   = pp.x + (dx / dist) * Math.max(0, dist - 1.5);
      const nz   = pp.z + (dz / dist) * Math.max(0, dist - 1.5);
      if (player.collider?.passable(nx, nz)) {
        player.mesh.position.x = nx;
        player.mesh.position.z = nz;
      }
      const dmg  = Math.floor(build?.getWeaponDamage?.() ?? 50);
      const dead = target.takeDamage(dmg);
      eventBus?.emit('enemy_damaged', { enemyId: target.id, amount: dmg, isCrit: false, position: target.mesh.position });
      if (dead) eventBus?.emit('enemy_killed', _killPayload(target));
      spawnEffect(target.mesh.position, 0xe74c3c, 1.0);
      eventBus?.emit('ability_used', { abilityId: 'charge', damage: dmg });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ROGUE
  // ══════════════════════════════════════════════════════════════════════════

  backstab: {
    id:          'backstab',
    name:        'Backstab',
    type:        'instant_aoe',
    description: 'Deal massive damage to a single nearby enemy.',
    cooldown:    4.0,
    manaCost:    0,
    animation:   'attack',
    sfx:         'combat.attack',
    effect({ player, registry, build, eventBus, spawnEffect }) {
      const pp     = player.mesh.position;
      const target = _nearest(registry, pp, 3);
      if (!target) return;
      const str = build?.getStats()?.strength ?? 5;
      const agi = build?.getStats()?.agility  ?? 10;
      const dmg = Math.floor((str * 5.0 + agi * 2.0) * (build?.getDamageMultiplier() ?? 1));
      const dead = target.takeDamage(dmg);
      eventBus?.emit('enemy_damaged', { enemyId: target.id, amount: dmg, isCrit: false, position: target.mesh.position });
      if (dead) eventBus?.emit('enemy_killed', _killPayload(target));
      spawnEffect(target.mesh.position, 0x2ecc71, 0.9);
      eventBus?.emit('ability_used', { abilityId: 'backstab', damage: dmg });
    },
  },

  dash: {
    id:          'dash',
    name:        'Dash',
    type:        'mobility',
    description: 'Quickly dash in your movement direction.',
    cooldown:    4.0,
    manaCost:    0,
    animation:   'attack',
    sfx:         'combat.attack',
    effect({ player, spawnEffect, eventBus }) {
      const dir = new THREE.Vector3();
      if (player.keys?.['w']) dir.z -= 1;
      if (player.keys?.['s']) dir.z += 1;
      if (player.keys?.['a']) dir.x -= 1;
      if (player.keys?.['d']) dir.x += 1;
      if (dir.lengthSq() === 0) dir.z = -1;
      dir.normalize().multiplyScalar(5);
      const nx = player.mesh.position.x + dir.x;
      const nz = player.mesh.position.z + dir.z;
      if (player.collider?.passable(nx, nz)) {
        player.mesh.position.x = nx;
        player.mesh.position.z = nz;
      }
      spawnEffect(player.mesh.position, 0x2ecc71, 0.6);
      eventBus?.emit('ability_used', { abilityId: 'dash' });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  MAGE — ALL DAMAGE VIA build.getSpellDamage(skillId, scalar)
  //
  //  DESIGN: Damage = computedSkill(skill) × SCALAR × abilityDamageMultiplier
  //  Skills (fire, lightning, pulse) are trained with skill points.
  //  Stats (INT, WIS) multiply the trained value via computedSkill().
  //  Result: both training AND stat investment matter.
  // ══════════════════════════════════════════════════════════════════════════

  // Fireball — projectile + explosion, scales from fire skill
  fireball: {
    id:          'fireball',
    name:        'Fireball',
    type:        'projectile',
    description: `Fireball that explodes on impact. Fire skill scaling. ${MANA_FIREBALL} mp.`,
    cooldown:    0.60,
    manaCost:    MANA_FIREBALL,
    animation:   'cast',
    sfx:         'ui.confirm',
    effect({ player, registry, build, eventBus, spawnProjectile }) {
      if (!build?.consumeMana(MANA_FIREBALL)) {
        eventBus?.emit('ability_failed', { reason: 'oom', abilityId: 'fireball' });
        return;
      }
      // NEW: damage from fire skill; fallback to INT-based formula if skill unavailable
      const dmg = build?.getSpellDamage?.('fire', FIRE_SCALAR)
        ?? Math.floor((build?.getStats()?.intelligence ?? 10) * 6.5 * (build?.getAbilityDamageMultiplier() ?? 1));

      // Ability level provides a small bonus on top
      const sl  = build?.getSkillLevel?.('fireball') ?? 1;
      const finalDmg = Math.floor(dmg * (1 + (sl - 1) * 0.08));

      spawnProjectile('fireball', _aimDir(player, registry), finalDmg);
      eventBus?.emit('ability_used', { abilityId: 'fireball', damage: finalDmg });
      eventBus?.emit('mana_changed', { mana: build.getCurrentMana(), max: build.getManaPool() });

      if (typeof __debug !== 'undefined' && __debug?.ability?._debug) {
        const computed = build?.getComputedSkill?.('fire') ?? '?';
        console.log(`[Fireball] fire_skill=${computed}  sl=${sl}  dmg=${finalDmg}`);
      }
    },
  },

  // Lightning Ball — fast single-target bolt, scales from lightning skill
  lightning_ball: {
    id:          'lightning_ball',
    name:        'Lightning Ball',
    type:        'projectile',
    description: `Very fast lightning bolt. Lightning skill. ${MANA_LBALL} mp.`,
    cooldown:    0.25,
    manaCost:    MANA_LBALL,
    animation:   'cast',
    sfx:         'ui.confirm',
    effect({ player, registry, build, eventBus, spawnProjectile }) {
      if (!build?.consumeMana(MANA_LBALL)) {
        eventBus?.emit('ability_failed', { reason: 'oom', abilityId: 'lightning_ball' });
        return;
      }
      const dmg = build?.getSpellDamage?.('lightning', LBALL_SCALAR)
        ?? Math.floor((build?.getStats()?.intelligence ?? 10) * 5.0 * (build?.getAbilityDamageMultiplier() ?? 1));

      spawnProjectile('lightning_ball', _aimDir(player, registry), dmg);
      eventBus?.emit('ability_used', { abilityId: 'lightning_ball', damage: dmg });
      eventBus?.emit('mana_changed', { mana: build.getCurrentMana(), max: build.getManaPool() });
    },
  },

  // Magic Missile — spammable bolt, uses lightning skill at lower scalar
  magic_missile: {
    id:          'magic_missile',
    name:        'Magic Missile',
    type:        'projectile',
    description: `Spammable arcane bolt. Lightning skill. ${MANA_MISSILE} mp.`,
    cooldown:    0.30,
    manaCost:    MANA_MISSILE,
    animation:   'cast',
    sfx:         'ui.confirm',
    effect({ player, registry, build, eventBus, spawnProjectile }) {
      if (!build?.consumeMana(MANA_MISSILE)) {
        eventBus?.emit('ability_failed', { reason: 'oom', abilityId: 'magic_missile' });
        return;
      }
      const dmg = build?.getSpellDamage?.('lightning', MISSILE_SCALAR)
        ?? Math.floor((build?.getStats()?.intelligence ?? 10) * 3.5 * (build?.getAbilityDamageMultiplier() ?? 1));

      spawnProjectile('magic_missile', _aimDir(player, registry), dmg);
      eventBus?.emit('ability_used', { abilityId: 'magic_missile', damage: dmg });
      eventBus?.emit('mana_changed', { mana: build.getCurrentMana(), max: build.getManaPool() });
    },
  },

  // Lightning Bolt — contextual orbit/projectile, scales from lightning skill
  lightning_bolt: {
    id:          'lightning_bolt',
    name:        'Lightning Bolt',
    type:        'contextual',
    description: `Orbit (close) or projectile (aimed). Lightning skill. ${MANA_LBOLT} mp.`,
    cooldown:    0.45,
    manaCost:    MANA_LBOLT,
    animation:   'cast',
    sfx:         'ui.confirm',
    effect({ player, registry, build, eventBus, spawnProjectile, lightningPulse }) {
      if (!build?.consumeMana(MANA_LBOLT)) {
        eventBus?.emit('ability_failed', { reason: 'oom', abilityId: 'lightning_bolt' });
        return;
      }

      const dmg = build?.getSpellDamage?.('lightning', LBOLT_SCALAR)
        ?? Math.floor((build?.getStats()?.intelligence ?? 10) * 4.0 * (build?.getAbilityDamageMultiplier() ?? 1));

      // Mode: projectile if cursor is > 4 units away, else orbit
      const pp   = player.mesh?.position;
      let aimed  = false;
      if (pp && player._aimTarget) {
        const adx = player._aimTarget.x - pp.x;
        const adz = player._aimTarget.z - pp.z;
        aimed = (adx * adx + adz * adz) >= LBOLT_AIM_THRESHOLD_SQ;
      }

      if (aimed) {
        spawnProjectile('lightning_bolt', _aimDir(player, registry), dmg);
        eventBus?.emit('ability_used', { abilityId: 'lightning_bolt', mode: 'projectile', damage: dmg });
      } else {
        // Short-duration orbit (reads pulse duration from build if available)
        const dur = build?.getPulseDuration?.()
          ? Math.min(build.getPulseDuration() * 0.4, 1.5)  // bolt orbit shorter than full pulse
          : Math.min(1.5, 0.5 + (build?.getComputedSkill?.('lightning') ?? 5) * 0.018);
        lightningPulse?.activate(dur, 1, dmg);
        eventBus?.emit('ability_used', { abilityId: 'lightning_bolt', mode: 'orbit', duration: dur });
      }

      eventBus?.emit('mana_changed', { mana: build.getCurrentMana(), max: build.getManaPool() });
    },
  },

  // Lightning Pulse — timed orbit, scales from pulse skill + duration skill
  lightning_pulse: {
    id:          'lightning_pulse',
    name:        'Lightning Pulse',
    type:        'timed_orbit',
    description: `Orbiting lightning nodes. Pulse+Duration skills. ${MANA_PULSE} mp.`,
    cooldown:    8.0,
    manaCost:    MANA_PULSE,
    animation:   'cast',
    sfx:         'ui.confirm',
    effect({ player, build, eventBus, lightningPulse }) {
      if (!build?.consumeMana(MANA_PULSE)) {
        eventBus?.emit('ability_failed', { reason: 'oom', abilityId: 'lightning_pulse' });
        return;
      }
      const dmg  = build?.getSpellDamage?.('pulse', PULSE_SCALAR)
        ?? Math.floor((build?.getStats()?.intelligence ?? 10) * 2.2 * (build?.getAbilityDamageMultiplier() ?? 1));
      // Duration from pulse + duration skills
      const dur  = build?.getPulseDuration?.()
        ?? Math.min(3.5, 0.5 + (build?.getStats()?.intelligence ?? 10) * 0.08 + (build?.getStats()?.wisdom ?? 8) * 0.06);
      // Node count: 1 base + 1 per 10 computed pulse skill
      const pulseVal = build?.getComputedSkill?.('pulse') ?? 5;
      const nodes    = Math.min(3, 1 + Math.floor(pulseVal / 10));

      lightningPulse?.activate(dur, nodes, dmg);
      eventBus?.emit('ability_used', { abilityId: 'lightning_pulse', duration: dur });
      eventBus?.emit('mana_changed', { mana: build.getCurrentMana(), max: build.getManaPool() });

      if (typeof __debug !== 'undefined' && __debug?.ability?._debug) {
        console.log(`[Pulse] pulseSkill=${pulseVal}  dur=${dur.toFixed(2)}s  nodes=${nodes}  dmg=${dmg}`);
      }
    },
  },

  // Magic Shield — absorb damage, scales from magicShield + duration skills
  magic_shield: {
    id:          'magic_shield',
    name:        'Magic Shield',
    type:        'buff',
    description: `Shield absorbs damage. Magic Shield + Duration skills. ${MANA_SHIELD} mp.`,
    cooldown:    10.0,
    manaCost:    MANA_SHIELD,
    animation:   'cast',
    sfx:         'ui.confirm',
    effect({ player, build, eventBus, spawnEffect }) {
      if (!build?.consumeMana(MANA_SHIELD)) {
        eventBus?.emit('ability_failed', { reason: 'oom', abilityId: 'magic_shield' });
        return;
      }

      // Skill-based shield value
      let shieldVal, duration;
      if (build?.getMagicShieldStats) {
        ({ value: shieldVal, duration } = build.getMagicShieldStats());
      } else {
        // Fallback to INT/WIS if skill system unavailable
        const s    = build?.getStats() ?? { intelligence: 10, wisdom: 8 };
        shieldVal  = Math.floor(s.intelligence * 4 + s.wisdom * 2);
        duration   = Math.min(12, 3 + s.intelligence * 0.15 + s.wisdom * 0.10);
      }

      player.shield      = shieldVal;
      player.maxShield   = shieldVal;
      player._shieldExpiry = performance.now() + duration * 1000;

      spawnEffect(player.mesh.position, 0x4488ff, 1.4);
      eventBus?.emit('magic_shield_applied', { value: shieldVal, duration });
      eventBus?.emit('ability_used', { abilityId: 'magic_shield', value: shieldVal });
      eventBus?.emit('mana_changed', { mana: build.getCurrentMana(), max: build.getManaPool() });
      console.log(`[Ability] Magic Shield: ${shieldVal} pts for ${duration.toFixed(1)}s`);
    },
  },
};

// ── Default slot assignments ───────────────────────────────────────────────
//
// Warrior: 2 slots — surround_hit(toggle) + warcry(control)
// Rogue:   2 slots — backstab + dash
// Mage:    5 slots — full spell kit
const CLASS_SLOTS = {
  warrior: ['surround_hit', 'warcry'],
  rogue:   ['backstab',     'dash'],
  mage:    ['fireball', 'lightning_ball', 'lightning_bolt', 'lightning_pulse', 'magic_shield'],
};

// ── AbilitySystem ─────────────────────────────────────────────────────────────

export class AbilitySystem {
  constructor() {
    this._slots          = [null, null];
    this._visualEffects  = [];
    this._registry       = null;
    this._eventBus       = null;
    this._rng            = null;
    this._scene          = null;
    this._player         = null;
    this._build          = null;
    this._projectileSys  = null;
    this._lightningPulse = null;
    this._statusFX       = null;
    this._debug          = false;
    this.instantCooldown = false;
  }

  // ── Context ────────────────────────────────────────────────────────────────

  setContext({ scene, player, build, projectileSys, lightningPulse, statusFX }) {
    this._scene          = scene;
    this._player         = player;
    this._build          = build;
    this._projectileSys  = projectileSys  ?? this._projectileSys;
    this._lightningPulse = lightningPulse ?? this._lightningPulse;
    this._statusFX       = statusFX       ?? this._statusFX;
  }

  init(_zone, registry, eventBus, rng = null) {
    this._registry = registry;
    this._eventBus = eventBus;
    this._rng      = rng;
  }

  // ── Slot management ────────────────────────────────────────────────────────

  setClass(classId) {
    const defs = CLASS_SLOTS[classId] ?? [];
    this._slots = defs.map(id => _makeSlot(id));
    while (this._slots.length < 2) this._slots.push(null);
  }

  upgradeSlot(slotIndex, abilityId) {
    const def = ABILITY_DEFS[abilityId];
    if (!def) { console.warn(`[Ability] Unknown ability: "${abilityId}"`); return; }
    while (this._slots.length <= slotIndex) this._slots.push(null);
    this._slots[slotIndex] = _makeSlot(abilityId);
    this._eventBus?.emit('ability_unlocked', { abilityId, slotIndex });
    console.log(`[Ability] Slot ${slotIndex} → ${def.name}`);
  }

  /** @deprecated use upgradeSlot(1, id) */
  upgradeSlot1(abilityId) { this.upgradeSlot(1, abilityId); }

  // ── Activation ─────────────────────────────────────────────────────────────

  activate(slotIndex) {
    const slot = this._slots[slotIndex];
    if (!slot || !slot.def) return false;
    if (slot.currentCooldown > 0) return false;

    const cdr = this._build?.getCooldownReduction() ?? 0;

    const ctx = {
      player:         this._player,
      registry:       this._registry,
      build:          this._build,
      eventBus:       this._eventBus,
      rng:            this._rng,
      statusFX:       this._statusFX,
      lightningPulse: this._lightningPulse,

      spawnEffect: (pos, color, radius) => {
        const fx = _spawnRing(this._scene, pos, color, radius);
        if (fx) this._visualEffects.push(fx);
      },

      spawnProjectile: (abilityId, dir, damage) => {
        const pp = this._player?.mesh?.position;
        if (!pp) return;
        this._projectileSys?.spawn(abilityId, { x: pp.x, z: pp.z }, dir, damage);
      },
    };

    slot.def.effect(ctx);

    this._eventBus?.emit('skill_cast', {
      abilityId:     slot.def.id,
      animationType: slot.def.animation ?? 'attack',
      sfx:           slot.def.sfx ?? 'combat.attack',
      entityId:      'player',
    });

    slot.currentCooldown = this.instantCooldown ? 0 : slot.def.cooldown * (1 - cdr);
    return true;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(delta) {
    // Tick cooldowns
    for (const slot of this._slots) {
      if (!slot || slot.currentCooldown <= 0) continue;
      const prev = slot.currentCooldown;
      slot.currentCooldown = Math.max(0, slot.currentCooldown - delta);
      if (slot.currentCooldown === 0 && prev > 0) {
        this._eventBus?.emit('ability_ready', { abilityId: slot.def.id });
      }
    }

    // Mana regen — uses meditate skill for mage, WIS-only otherwise
    if (this._build) {
      const regen = this._build.getManaRegenTotal?.()
        ?? this._build.getManaRegen?.()
        ?? 0;
      this._build.restoreMana(regen * delta);
    }

    // HP regen — from regenerate skill (warrior/rogue)
    if (this._build && this._player) {
      const hpRegen = this._build.getHpRegen?.() ?? 0;
      if (hpRegen > 0 && this._player.hp < this._player.maxHp) {
        this._player.hp = Math.min(
          this._player.maxHp,
          (this._player.hp ?? 0) + hpRegen * delta,
        );
      }
    }

    // Parry timer
    if (this._player?._parryTimer > 0) {
      this._player._parryTimer -= delta;
      if (this._player._parryTimer <= 0) {
        this._player._parryTimer  = 0;
        this._player._parryActive = false;
        this._eventBus?.emit('parry_ended', {});
      }
    }

    // Magic shield expiry
    if (this._player?.shield > 0 && this._player?._shieldExpiry) {
      if (performance.now() >= this._player._shieldExpiry) {
        this._player.shield        = 0;
        this._player.maxShield     = 0;
        this._player._shieldExpiry = null;
        this._eventBus?.emit('magic_shield_ended', {});
        if (this._debug) console.log('[Ability] Magic Shield expired');
      }
    }

    // Fade visual ring effects
    for (let i = this._visualEffects.length - 1; i >= 0; i--) {
      const fx = this._visualEffects[i];
      fx.timer -= delta;
      if (fx.timer <= 0) {
        this._scene?.remove(fx.mesh);
        this._visualEffects.splice(i, 1);
      } else {
        fx.mat.opacity = (fx.timer / 0.5) * 0.75;
      }
    }
  }

  onEvent(_event) {}

  /**
   * Returns slot data for the HUD.
   * Refreshes toggle `isActive` state each call so HUD stays in sync.
   */
  getSlots() {
    return this._slots.map(slot => {
      if (!slot) return null;
      // Refresh toggle state (surround_hit etc.)
      if (slot.def.activeCheck) {
        slot.isActive = slot.def.activeCheck({ player: this._player });
      }
      return slot;
    });
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save() {
    return {
      slot0: this._slots[0]?.def.id ?? null,
      slot1: this._slots[1]?.def.id ?? null,
    };
  }

  load(data) {
    if (!data) return;
    if (data.slot0) this._slots[0] = _makeSlot(data.slot0);
    if (data.slot1) this._slots[1] = _makeSlot(data.slot1);
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  setDebug(on = true) { this._debug = on; }

  inspect() {
    const mana   = this._build
      ? `  Mana: ${Math.floor(this._build.getCurrentMana())}/${this._build.getManaPool()}`
      : '';
    const shield = (this._player?.shield ?? 0) > 0
      ? `  Shield: ${this._player.shield}`
      : '';
    const surround = (this._player?.surroundHitActive)
      ? '  [SurroundHit: ON]'
      : '';
    console.group(`[AbilitySystem]${mana}${shield}${surround}`);
    for (const [i, slot] of this._slots.entries()) {
      if (!slot) { console.log(`  [${i}] (empty)`); continue; }
      const cd     = slot.currentCooldown > 0 ? `${slot.currentCooldown.toFixed(1)}s` : 'READY';
      const cost   = slot.def.manaCost > 0    ? `  mp:${slot.def.manaCost}` : '';
      const type   = `  [${slot.def.type ?? '?'}]`;
      const active = slot.isActive             ? '  ★ACTIVE' : '';
      console.log(`  [${i}] ${slot.def.name}  cd=${cd}${cost}${type}${active}`);
    }
    console.groupEnd();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _makeSlot(abilityId) {
  const def = ABILITY_DEFS[abilityId];
  if (!def) return null;
  return { def, currentCooldown: 0, isActive: false };
}

function _nearest(registry, pos, maxRange) {
  let best = null, bestDist = maxRange * maxRange;
  for (const e of registry?.getEntitiesByType('enemy') ?? []) {
    if (!e.alive) continue;
    const dx = e.mesh.position.x - pos.x, dz = e.mesh.position.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist) { best = e; bestDist = d2; }
  }
  return best;
}

/**
 * Aim direction for projectiles.
 * Priority: cursor (_aimTarget) → nearest enemy → last move dir → north
 */
function _aimDir(player, registry) {
  const pp = player.mesh.position;

  if (player._aimTarget) {
    const dx = player._aimTarget.x - pp.x;
    const dz = player._aimTarget.z - pp.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.1) return { x: dx / len, z: dz / len };
  }

  if (registry) {
    let best = null, bestDist = Infinity;
    for (const e of registry.getEntitiesByType('enemy') ?? []) {
      if (!e.alive) continue;
      const dx = e.mesh.position.x - pp.x;
      const dz = e.mesh.position.z - pp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDist) { best = e; bestDist = d2; }
    }
    if (best) {
      const dx  = best.mesh.position.x - pp.x;
      const dz  = best.mesh.position.z - pp.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      return { x: dx / len, z: dz / len };
    }
  }

  return player._lastMoveDir ?? { x: 0, z: -1 };
}

function _killPayload(e) {
  return {
    enemyId: e.id, id: e.id,
    xpValue: e.xpValue ?? 10,
    x: e.mesh.position.x, z: e.mesh.position.z,
    position: e.mesh.position,
  };
}

function _spawnRing(scene, pos, color, radius) {
  if (!scene) return null;
  const geo  = new THREE.TorusGeometry(radius, 0.08, 4, 32);
  const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(pos.x, 0.3, pos.z);
  scene.add(mesh);
  return { mesh, mat, timer: 0.5 };
}
