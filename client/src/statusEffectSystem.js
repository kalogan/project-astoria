// statusEffectSystem.js — timed buff/debuff effects on entities.
//
// Effects are stored on the target entity as entity._statusEffects (a Map).
// The system ticks every frame, applies periodic damage for burn, and removes
// expired effects.  Integration is flag-based — effects set lightweight
// properties on entities that the rest of the engine already reads:
//
//   stun    → entity._stunned = true          (EnemySystem skips update)
//   slow    → entity._slowMult = 0.4          (stored; applied to speed)
//   burn    → entity._burning = true          (tick emits 'status_tick')
//   weaken  → entity._weakenMult = 0.7        (EnemySystem uses for attackDamage)
//
// API
//   applyEffect(targetId, effectId, opts)   — apply or refresh an effect
//   removeEffect(targetId, effectId)        — remove immediately
//   clearEffects(targetId)                  — clear all effects (e.g. on respawn)
//   hasEffect(targetId, effectId)           — query
//
// Events emitted
//   'status_applied'  { targetId, effectId, duration, label }
//   'status_removed'  { targetId, effectId }
//   'status_tick'     { targetId, effectId, damage }    ← for burn DoT

// ── Effect definitions ────────────────────────────────────────────────────────

export const EFFECT_DEFS = {

  stun: {
    id:    'stun',
    label: 'Stunned',
    apply(entity)  { entity._stunned = true; },
    remove(entity) { entity._stunned = false; },
  },

  slow: {
    id:    'slow',
    label: 'Slowed',
    apply(entity, opts) {
      // Store original speed so we can restore it exactly
      if (entity._slowMult === undefined || entity._slowMult === 1.0) {
        entity._preSlowSpeed = entity._speed ?? null;  // enemies have _speed
      }
      const mult = opts?.magnitude ?? 0.45;
      entity._slowMult = mult;
      if (entity._speed !== undefined) entity._speed = (entity._preSlowSpeed ?? entity._speed) * mult;
    },
    remove(entity) {
      entity._slowMult = 1.0;
      if (entity._preSlowSpeed !== undefined) {
        entity._speed = entity._preSlowSpeed;
        entity._preSlowSpeed = undefined;
      }
    },
  },

  burn: {
    id:       'burn',
    label:    'Burning',
    tickRate: 0.5,   // DoT every 0.5 seconds
    apply(entity)  { entity._burning = true; },
    remove(entity) { entity._burning = false; },
  },

  weaken: {
    id:    'weaken',
    label: 'Weakened',
    apply(entity, opts) {
      entity._weakenMult = opts?.magnitude ?? 0.65;
    },
    remove(entity) {
      entity._weakenMult = 1.0;
    },
  },
};

// ── StatusEffectSystem ────────────────────────────────────────────────────────

export class StatusEffectSystem {
  constructor() {
    this._registry = null;
    this._eventBus = null;
    this._player   = null;
    this._debug    = false;
    this._bound    = false;
  }

  setContext({ player }) {
    this._player = player;
  }

  init(_zone, registry, eventBus) {
    this._registry = registry;
    this._eventBus = eventBus;
    if (!this._bound) {
      this._bindEvents();
      this._bound = true;
    }
    // Clear all effects when entering a new zone
    this._clearAll();
  }

  onEvent() {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Apply (or refresh) a status effect on a target.
   * @param {string} targetId  — 'player' or enemy id
   * @param {string} effectId  — 'stun' | 'burn' | 'slow' | 'weaken'
   * @param {object} [opts]    — { duration (s), magnitude, tickDamage, sourceId }
   */
  applyEffect(targetId, effectId, opts = {}) {
    const def = EFFECT_DEFS[effectId];
    if (!def) {
      console.warn(`[StatusFX] Unknown effect: "${effectId}"`);
      return;
    }

    const entity = this._getEntity(targetId);
    if (!entity) return;

    if (!entity._statusEffects) entity._statusEffects = new Map();

    const duration = opts.duration ?? 3.0;
    const existing = entity._statusEffects.get(effectId);

    if (existing) {
      // Refresh — extend duration but don't re-apply modifiers
      existing.remaining = Math.max(existing.remaining, duration);
      if (this._debug) console.log(`[StatusFX] Refreshed "${effectId}" on "${targetId}"`);
      return;
    }

    def.apply(entity, opts);

    entity._statusEffects.set(effectId, {
      effectId,
      remaining:  duration,
      tickTimer:  def.tickRate ?? 0,
      tickRate:   def.tickRate ?? 0,
      tickDamage: opts.tickDamage ?? 6,
      sourceId:   opts.sourceId ?? 'unknown',
    });

    this._eventBus?.emit('status_applied', {
      targetId,
      effectId,
      duration,
      label: def.label,
    });

    if (this._debug) console.log(`[StatusFX] Applied "${effectId}" to "${targetId}" (${duration}s)`);
  }

  /** Remove a specific effect immediately. */
  removeEffect(targetId, effectId) {
    const entity = this._getEntity(targetId);
    if (!entity?._statusEffects?.has(effectId)) return;

    EFFECT_DEFS[effectId]?.remove(entity);
    entity._statusEffects.delete(effectId);

    this._eventBus?.emit('status_removed', { targetId, effectId });
    if (this._debug) console.log(`[StatusFX] Removed "${effectId}" from "${targetId}"`);
  }

  /** Remove all effects from an entity. */
  clearEffects(targetId) {
    const entity = this._getEntity(targetId);
    if (!entity?._statusEffects?.size) return;
    for (const id of [...entity._statusEffects.keys()]) {
      this.removeEffect(targetId, id);
    }
  }

  hasEffect(targetId, effectId) {
    return this._getEntity(targetId)?._statusEffects?.has(effectId) ?? false;
  }

  /** Called every frame by SystemManager. */
  update(delta) {
    if (!this._registry) return;

    for (const enemy of this._registry.getEntitiesByType('enemy')) {
      if (enemy._statusEffects?.size) this._tickEntity(enemy.id, enemy, delta);
    }

    if (this._player?._statusEffects?.size) {
      this._tickEntity('player', this._player, delta);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _tickEntity(entityId, entity, delta) {
    for (const [effectId, state] of entity._statusEffects) {
      state.remaining -= delta;

      // Periodic tick (burn DoT)
      if (state.tickRate > 0) {
        state.tickTimer -= delta;
        if (state.tickTimer <= 0) {
          state.tickTimer += state.tickRate;
          this._eventBus?.emit('status_tick', {
            targetId:  entityId,
            effectId,
            damage:    state.tickDamage,
          });
        }
      }

      if (state.remaining <= 0) this.removeEffect(entityId, effectId);
    }
  }

  _getEntity(entityId) {
    if (entityId === 'player') return this._player ?? null;
    return this._registry?.getEntityById(entityId) ?? null;
  }

  _clearAll() {
    if (this._registry) {
      for (const e of this._registry.getEntitiesByType('enemy')) {
        if (e._statusEffects?.size) this.clearEffects(e.id);
      }
    }
    if (this._player?._statusEffects?.size) this.clearEffects('player');
  }

  _bindEvents() {
    // status_tick is handled in main.js (applies damage to entity)
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setDebug(on = true) { this._debug = on; }

  inspect(targetId = 'player') {
    const entity = this._getEntity(targetId);
    if (!entity?._statusEffects?.size) {
      console.log(`[StatusFX] "${targetId}": no active effects`);
      return;
    }
    console.group(`[StatusFX] "${targetId}"`);
    for (const [id, s] of entity._statusEffects) {
      console.log(`  ${id}: ${s.remaining.toFixed(1)}s remaining`);
    }
    console.groupEnd();
  }

  inspectAll() {
    const enemies = this._registry?.getEntitiesByType('enemy') ?? [];
    const active  = enemies.filter(e => e._statusEffects?.size);
    if (!active.length && !this._player?._statusEffects?.size) {
      console.log('[StatusFX] No active effects anywhere');
      return;
    }
    for (const e of active) this.inspect(e.id);
    if (this._player?._statusEffects?.size) this.inspect('player');
  }

  forceExpire(targetId, effectId) {
    this.removeEffect(targetId, effectId);
    console.log(`[StatusFX] Force-expired "${effectId}" on "${targetId}"`);
  }
}
