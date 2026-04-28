// enemyAbilitySystem.js — enemy ability AI with boss capability layer.
//
// Enemies opt in by setting entity.abilityType to a key in ENEMY_ABILITY_REGISTRY.
// Enemies without abilityType are untouched (backward compatible).
//
// Ability definition fields:
//   id, name, animation, sfx, cooldown (s), range (units), priority (higher = preferred),
//   condition: 'always' | 'hp_below' | 'player_close' | 'hp_above',
//   conditionValue: number (0–1 fraction for hp conditions),
//   damage: { multiplier }       — scales base enemy damage
//   appliesEffect: { id, duration, magnitude?, tickDamage? }
//   telegraphMs: number          — wind-up warning time before execution
//
// Boss layer (optional on any registry entry):
//   behavior: { state, states: { default, aggressive, rage } }
//     — each state: { speedMult, damageMult, abilities: [abilityId, ...] }
//   triggers: [{ type: 'health_below', value: 0–1, action: 'set_state'|'use_ability', target }]
//   sequence: [abilityId, ...]   — if present, cycles through this array in order
//
// Execute flow:
//   1. update() picks best ability (priority + condition + cooldown)
//   2. Emits enemy_ability_pending  { enemyId, abilityId, telegraphMs, position }
//   3. After telegraphMs, executes:
//        — range re-check, damage to player, status effect, animation, SFX
//        — Emits enemy_ability_execute { enemyId, abilityId }
//        — Emits skill_cast           { entityId, abilityId, animationType }
//
// Events listened:  (none — polled in update)
// Events emitted:   enemy_ability_pending, enemy_ability_execute

import { EFFECT_DEFS } from './statusEffectSystem.js';

// ── Ability registry ──────────────────────────────────────────────────────────

const MELEE_FALLBACK = {
  id: 'melee_strike', name: 'Strike', animation: 'attack', sfx: 'combat.attack',
  cooldown: 1.8, range: 2.2, priority: 0, condition: 'always', telegraphMs: 0,
  damage: { multiplier: 1.0 },
};

export const ENEMY_ABILITY_REGISTRY = {

  // ── Basic enemies ──────────────────────────────────────────────────────────

  zombie_brute: {
    abilities: [
      {
        id: 'slam', name: 'Ground Slam', animation: 'attack', sfx: 'combat.attack',
        cooldown: 5.0, range: 2.5, priority: 2, condition: 'always', telegraphMs: 600,
        damage: { multiplier: 1.8 },
        appliesEffect: { id: 'slow', duration: 3.0, magnitude: 0.35 },
      },
      { ...MELEE_FALLBACK, cooldown: 2.0 },
    ],
  },

  skeleton_warrior: {
    abilities: [
      {
        id: 'stun_strike', name: 'Stun Strike', animation: 'attack', sfx: 'combat.attack',
        cooldown: 7.0, range: 2.0, priority: 3, condition: 'always', telegraphMs: 450,
        damage: { multiplier: 1.4 },
        appliesEffect: { id: 'stun', duration: 1.8 },
      },
      {
        id: 'weaken_blow', name: 'Weakening Blow', animation: 'attack', sfx: 'combat.attack',
        cooldown: 9.0, range: 2.0, priority: 2, condition: 'hp_below', conditionValue: 0.5,
        telegraphMs: 300,
        damage: { multiplier: 1.1 },
        appliesEffect: { id: 'weaken', duration: 5.0, magnitude: 0.6 },
      },
      { ...MELEE_FALLBACK },
    ],
  },

  fire_mage_enemy: {
    abilities: [
      {
        id: 'enemy_fireball', name: 'Fireball', animation: 'cast', sfx: 'ui.confirm',
        cooldown: 4.5, range: 9.0, priority: 3, condition: 'always', telegraphMs: 700,
        damage: { multiplier: 1.5 },
        appliesEffect: { id: 'burn', duration: 4.0, tickDamage: 5 },
      },
      {
        id: 'enemy_nova', name: 'Fire Nova', animation: 'cast', sfx: 'ui.confirm',
        cooldown: 10.0, range: 4.0, priority: 4, condition: 'player_close', conditionValue: 3.5,
        telegraphMs: 800,
        damage: { multiplier: 2.0 },
        appliesEffect: { id: 'burn', duration: 3.0, tickDamage: 8 },
      },
      { ...MELEE_FALLBACK, range: 1.8, priority: 0, cooldown: 2.5 },
    ],
  },

  // ── Boss: Sewer Guardian ───────────────────────────────────────────────────

  sewer_boss: {
    abilities: [
      {
        id: 'boss_cleave', name: 'Wide Cleave', animation: 'attack', sfx: 'combat.attack',
        cooldown: 4.0, range: 3.0, priority: 3, condition: 'always', telegraphMs: 500,
        damage: { multiplier: 1.6 },
      },
      {
        id: 'boss_charge', name: 'Charge', animation: 'attack', sfx: 'combat.attack',
        cooldown: 8.0, range: 8.0, priority: 4, condition: 'hp_above', conditionValue: 0.2,
        telegraphMs: 650,
        damage: { multiplier: 2.2 },
        appliesEffect: { id: 'stun', duration: 1.5 },
      },
      {
        id: 'boss_roar', name: 'Intimidating Roar', animation: 'cast', sfx: 'ui.confirm',
        cooldown: 14.0, range: 6.0, priority: 5, condition: 'always', telegraphMs: 800,
        damage: { multiplier: 0 },  // no direct damage
        appliesEffect: { id: 'weaken', duration: 6.0, magnitude: 0.55 },
      },
      {
        id: 'boss_slam_rage', name: 'Fury Slam', animation: 'attack', sfx: 'combat.attack',
        cooldown: 3.0, range: 2.8, priority: 5, condition: 'hp_below', conditionValue: 0.35,
        telegraphMs: 400,
        damage: { multiplier: 2.8 },
        appliesEffect: { id: 'slow', duration: 2.5, magnitude: 0.4 },
      },
      { ...MELEE_FALLBACK, cooldown: 1.8 },
    ],

    behavior: {
      state: 'default',
      states: {
        default:    { speedMult: 1.0, damageMult: 1.0 },
        aggressive: { speedMult: 1.3, damageMult: 1.35 },
        rage:       { speedMult: 1.6, damageMult: 1.7 },
      },
    },

    triggers: [
      { type: 'health_below', value: 0.60, action: 'set_state',   target: 'aggressive' },
      { type: 'health_below', value: 0.30, action: 'set_state',   target: 'rage' },
      { type: 'health_below', value: 0.30, action: 'use_ability', target: 'boss_roar' },
    ],
  },
};

// ── EnemyAbilitySystem ────────────────────────────────────────────────────────

export class EnemyAbilitySystem {
  constructor() {
    this._registry      = null;
    this._eventBus      = null;
    this._player        = null;
    this._statusFX      = null;   // injected after construction
    this._debug         = false;
    this._bound         = false;

    // enemyId → { cooldowns: Map<abilityId, remaining>, seqIndex, pendingAbility? }
    this._state = new Map();

    // enemyId → Set<triggerId> (fired triggers, so they only fire once)
    this._firedTriggers = new Map();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setContext({ player, statusFX }) {
    this._player   = player   ?? this._player;
    this._statusFX = statusFX ?? this._statusFX;
  }

  init(_zone, registry, eventBus) {
    this._registry = registry;
    this._eventBus = eventBus;
    this._state.clear();
    this._firedTriggers.clear();
    if (!this._bound) {
      this._bindEvents();
      this._bound = true;
    }
  }

  onEvent() {}

  update(delta) {
    if (!this._registry || !this._player) return;

    for (const enemy of this._registry.getEntitiesByType('enemy')) {
      if (enemy._dead || enemy._stunned) continue;

      const config = ENEMY_ABILITY_REGISTRY[enemy.abilityType];
      if (!config) continue;

      // Ensure per-enemy state entry
      if (!this._state.has(enemy.id)) {
        this._state.set(enemy.id, { cooldowns: new Map(), seqIndex: 0, pendingAbility: null });
      }
      const es = this._state.get(enemy.id);

      // Tick cooldowns
      for (const [aid, cd] of es.cooldowns) {
        const next = cd - delta;
        if (next <= 0) es.cooldowns.delete(aid);
        else           es.cooldowns.set(aid, next);
      }

      // Tick pending ability timer
      if (es.pendingAbility) {
        es.pendingAbility.timer -= delta * 1000;   // work in ms
        if (es.pendingAbility.timer <= 0) {
          this._execute(enemy, es.pendingAbility.ability, es, config);
          es.pendingAbility = null;
        }
        continue;  // one pending at a time
      }

      // Boss: check health triggers
      if (config.triggers) this._checkTriggers(enemy, es, config);

      // Select + start ability
      const chosen = this._selectAbility(enemy, es, config);
      if (chosen) this._startAbility(enemy, es, chosen, config);
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  _selectAbility(enemy, es, config) {
    const dist = this._distToPlayer(enemy);

    // Sequence mode overrides priority selection
    if (config.sequence?.length) {
      const seqAbilityId = config.sequence[es.seqIndex % config.sequence.length];
      const seqAbility   = config.abilities.find(a => a.id === seqAbilityId);
      if (seqAbility && !es.cooldowns.has(seqAbilityId) && this._checkCondition(seqAbility, enemy, dist)) {
        es.seqIndex++;
        return seqAbility;
      }
      return null;
    }

    // Behavior-state ability filter (boss only)
    let allowed = config.abilities;
    if (config.behavior) {
      const stateKey = config.behavior.state;
      const stateDef = config.behavior.states[stateKey];
      if (stateDef?.abilities) {
        allowed = config.abilities.filter(a => stateDef.abilities.includes(a.id));
        if (!allowed.length) allowed = config.abilities;  // fallback
      }
    }

    // Filter by range, condition, cooldown — then pick highest priority
    const usable = allowed.filter(a =>
      dist <= a.range &&
      !es.cooldowns.has(a.id) &&
      this._checkCondition(a, enemy, dist),
    );

    if (!usable.length) return null;
    usable.sort((a, b) => b.priority - a.priority);
    return usable[0];
  }

  _checkCondition(ability, enemy, dist) {
    const maxHp  = enemy._maxHp ?? enemy.hp ?? 1;
    const hpFrac = (enemy.hp ?? 0) / maxHp;
    switch (ability.condition) {
      case 'hp_below':    return hpFrac < (ability.conditionValue ?? 0.5);
      case 'hp_above':    return hpFrac > (ability.conditionValue ?? 0.5);
      case 'player_close':return dist <= (ability.conditionValue ?? 3.0);
      default:            return true;   // 'always'
    }
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  _startAbility(enemy, es, ability, _config) {
    const telegraphMs = ability.telegraphMs ?? 0;

    if (telegraphMs > 0) {
      this._eventBus?.emit('enemy_ability_pending', {
        enemyId:     enemy.id,
        abilityId:   ability.id,
        telegraphMs,
        position:    enemy.mesh?.position ?? { x: 0, y: 0, z: 0 },
      });
      es.pendingAbility = { ability, timer: telegraphMs };
      if (this._debug) console.log(`[EnemyAbility] "${enemy.id}" telegraphing "${ability.id}" (${telegraphMs}ms)`);
    } else {
      this._execute(enemy, ability, es, _config);
    }

    es.cooldowns.set(ability.id, ability.cooldown);
  }

  _execute(enemy, ability, _es, config) {
    if (enemy._dead) return;   // died during telegraph

    // Re-check range (player may have moved away)
    const dist = this._distToPlayer(enemy);
    if (dist > ability.range * 1.6) {
      if (this._debug) console.log(`[EnemyAbility] "${enemy.id}" aborted "${ability.id}" — out of range`);
      return;
    }

    this._eventBus?.emit('enemy_ability_execute', { enemyId: enemy.id, abilityId: ability.id });

    // Damage player
    if (ability.damage?.multiplier > 0) {
      const stateMult = this._stateMult(config, 'damageMult');
      const base      = enemy._attackDamage ?? enemy.attackDamage ?? 5;
      const dmg       = Math.round(base * ability.damage.multiplier * stateMult);
      this._eventBus?.emit('player_damaged', {
        damage:    dmg,
        sourceId:  enemy.id,
        abilityId: ability.id,
      });
    }

    // Apply status effect to player
    if (ability.appliesEffect && this._statusFX) {
      this._statusFX.applyEffect('player', ability.appliesEffect.id, ability.appliesEffect);
    }

    // Trigger animation + SFX via skill_cast convention
    this._eventBus?.emit('skill_cast', {
      entityId:      enemy.id,
      abilityId:     ability.id,
      animationType: ability.animation ?? 'attack',
      sfx:           ability.sfx,
    });

    if (this._debug) console.log(`[EnemyAbility] "${enemy.id}" executed "${ability.id}"`);
  }

  // ── Boss triggers ──────────────────────────────────────────────────────────

  _checkTriggers(enemy, es, config) {
    const maxHp  = enemy._maxHp ?? enemy.hp ?? 1;
    const hpFrac = (enemy.hp ?? 0) / maxHp;

    if (!this._firedTriggers.has(enemy.id)) this._firedTriggers.set(enemy.id, new Set());
    const fired = this._firedTriggers.get(enemy.id);

    for (const trigger of config.triggers) {
      const key = `${trigger.type}:${trigger.value}:${trigger.target}`;
      if (fired.has(key)) continue;

      let shouldFire = false;
      if (trigger.type === 'health_below') shouldFire = hpFrac < trigger.value;

      if (!shouldFire) continue;
      fired.add(key);

      if (trigger.action === 'set_state' && config.behavior) {
        const prev = config.behavior.state;
        config.behavior.state = trigger.target;
        this._applyBossStateToEnemy(enemy, config);
        if (this._debug) console.log(`[EnemyAbility] boss "${enemy.id}" → state "${trigger.target}" (was "${prev}")`);
        this._eventBus?.emit('boss_state_changed', { enemyId: enemy.id, state: trigger.target });
      }

      if (trigger.action === 'use_ability') {
        const forcedAbility = config.abilities.find(a => a.id === trigger.target);
        if (forcedAbility && !es.pendingAbility) {
          this._startAbility(enemy, es, forcedAbility, config);
        }
      }
    }
  }

  _applyBossStateToEnemy(enemy, config) {
    const stateKey = config.behavior?.state ?? 'default';
    const stateDef = config.behavior?.states?.[stateKey];
    if (!stateDef) return;

    if (stateDef.speedMult !== undefined && enemy._baseSpeed !== undefined) {
      enemy._speed = enemy._baseSpeed * stateDef.speedMult * (enemy._slowMult ?? 1.0);
    }
  }

  _stateMult(config, key) {
    if (!config.behavior) return 1.0;
    return config.behavior.states[config.behavior.state]?.[key] ?? 1.0;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _distToPlayer(enemy) {
    const pm = this._player?.mesh ?? this._player;
    const em = enemy.mesh;
    if (!pm || !em) return 999;
    const dx = pm.position.x - em.position.x;
    const dz = pm.position.z - em.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  _bindEvents() {
    // Enemy killed — clean up state
    this._eventBus?.on('enemy_killed', ({ payload }) => {
      const id = payload?.enemyId ?? payload?.id;
      if (id) {
        this._state.delete(id);
        this._firedTriggers.delete(id);
      }
    });
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setDebug(on = true) { this._debug = on; }

  inspect(enemyId) {
    const es = this._state.get(enemyId);
    if (!es) { console.log(`[EnemyAbility] "${enemyId}": no state`); return; }
    console.group(`[EnemyAbility] "${enemyId}"`);
    console.log('  cooldowns:', [...es.cooldowns.entries()].map(([k, v]) => `${k}:${v.toFixed(1)}s`).join(', ') || '(none)');
    console.log('  pending:', es.pendingAbility?.ability.id ?? 'none');
    console.log('  seqIndex:', es.seqIndex);
    console.groupEnd();
  }

  inspectAll() {
    if (!this._state.size) { console.log('[EnemyAbility] No active enemy states'); return; }
    for (const [id] of this._state) this.inspect(id);
  }

  /** Force an ability immediately (bypasses cooldown + telegraph). */
  force(enemyId, abilityId) {
    const enemy  = this._registry?.getEntityById(enemyId);
    const config = ENEMY_ABILITY_REGISTRY[enemy?.abilityType];
    if (!enemy || !config) { console.warn(`[EnemyAbility] force: unknown enemy "${enemyId}"`); return; }
    const ability = config.abilities.find(a => a.id === abilityId);
    if (!ability)           { console.warn(`[EnemyAbility] force: unknown ability "${abilityId}"`); return; }
    const es = this._state.get(enemyId) ?? { cooldowns: new Map(), seqIndex: 0, pendingAbility: null };
    this._execute(enemy, ability, es, config);
    console.log(`[EnemyAbility] forced "${abilityId}" on "${enemyId}"`);
  }

  /** List ability types available per abilityType key. */
  listAbilities(abilityType) {
    const config = ENEMY_ABILITY_REGISTRY[abilityType];
    if (!config) { console.warn(`[EnemyAbility] Unknown abilityType: "${abilityType}"`); return; }
    console.table(config.abilities.map(a => ({
      id: a.id, priority: a.priority, cooldown: a.cooldown, range: a.range,
      condition: a.condition, telegraph: a.telegraphMs,
    })));
  }
}
