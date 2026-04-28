// animationSystem.js — procedural, event-driven transform animations.
//
// Applies short-lived position/rotation/scale animations to entity meshes
// in response to game events.  No animation libraries, no state machines,
// no skeletal rigs — purely Three.js transform math, run in the existing
// game loop via SystemManager.update(delta).
//
// ── DESIGN RULES ─────────────────────────────────────────────────────────────
//   • Each active animation stores an ORIGINAL SNAPSHOT of the mesh transform
//     taken at the moment play() is called.  On completion the mesh is
//     reset exactly to that snapshot — zero drift guaranteed.
//   • New animations CANCEL any in-progress animation on the same entity.
//   • Position X/Z is NEVER modified — player movement owns those axes.
//     Only Y (vertical offset), rotation, and scale are touched.
//   • Death is a special case: mesh is forced visible during collapse,
//     then hidden at completion (overriding Enemy.takeDamage's instant hide).
//   • Idle breathing runs continuously on the player when no other animation
//     is active — scale.y oscillates ±1.2% at ~0.3 Hz.
//
// ── ANIMATION CATALOGUE ──────────────────────────────────────────────────────
//   attack   Player melee lunge:    squash wide + tilt, snap back         150ms
//   cast     Mage spell:            lift upward + scale pulse, settle     220ms
//   hit      Enemy damage react:    squash/stretch + Z wobble, pop back   130ms
//   death    Enemy die:             collapse height to ground, hide       400ms
//   parry    Warrior defend:        hunker + lean into stance, return     200ms
//
// ── EVENT MAP ────────────────────────────────────────────────────────────────
//   'skill_cast'     { animationType, abilityId }   → player animation
//   'attack_started' { source: 'auto' }             → player 'attack'
//   'enemy_damaged'  { enemyId }                    → enemy  'hit'
//   'enemy_killed'   { enemyId | id }               → enemy  'death'
//
// ── PART 7: PERFORMANCE NOTES ────────────────────────────────────────────────
//   _active is a Map; at most ~25 entries (player + enemies in zone).
//   snapOrig / resetToOrig work on plain objects — zero heap pressure.
//   apply functions reuse the stored orig object each frame.
//   _idleTime advances each frame with a simple +=; no extra objects created.

// ── Duration constants (seconds) ─────────────────────────────────────────────
const DUR = {
  attack: 0.15,
  cast:   0.22,
  hit:    0.13,
  death:  0.40,
  parry:  0.20,
};

// ── Easing / interpolation helpers ───────────────────────────────────────────
// All pure functions — no closures, no allocations.

function easeOut(t)    { return 1 - (1 - t) * (1 - t); }
function pingPong(t)   { return Math.sin(t * Math.PI); }          // 0 → 1 → 0
function lerp(a, b, t) { return a + (b - a) * t; }

// ── Transform snapshot ────────────────────────────────────────────────────────

/** Capture the current transform of a mesh into a plain object. */
function snapOrig(mesh) {
  return {
    px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
    rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z,
    sx: mesh.scale.x,    sy: mesh.scale.y,    sz: mesh.scale.z,
    visible: mesh.visible,
  };
}

/** Reset a mesh exactly to a previously captured snapshot. */
function resetToOrig(mesh, o) {
  mesh.position.set(o.px, o.py, o.pz);
  mesh.rotation.set(o.rx, o.ry, o.rz);
  mesh.scale.set(o.sx, o.sy, o.sz);
  mesh.visible = o.visible;
}

// ── Per-type apply functions ──────────────────────────────────────────────────
// Signature: fn(mesh, t, orig)
//   mesh  — the THREE.Mesh to transform
//   t     — normalised progress [0 .. 1]
//   orig  — snapshot from snapOrig()
//
// Rules:
//   • Only modify position.Y, rotation.{x,y,z}, scale.{x,y,z}
//   • position.X and position.Z are left untouched (owned by movement)
//   • At t=1 the caller resets via resetToOrig — no need to be exact at t=1

const APPLY = {

  // ── ATTACK ─────────────────────────────────────────────────────────────────
  // Squash wide + forward tilt (wind-up), then snap back.
  // Conveys weight and physical impact without position teleporting.
  attack(mesh, t, o) {
    if (t < 0.35) {
      // Wind-up: compress vertically, widen, tilt forward
      const p = t / 0.35;
      mesh.scale.set(
        lerp(o.sx, o.sx * 1.20, p),
        lerp(o.sy, o.sy * 0.78, p),
        lerp(o.sz, o.sz * 1.20, p),
      );
      mesh.rotation.x = lerp(o.rx, o.rx - 0.30, p);
      mesh.position.y = lerp(o.py, o.py - 0.07, p);
    } else {
      // Snap back with ease-out (punchy recovery)
      const p = easeOut((t - 0.35) / 0.65);
      mesh.scale.set(
        lerp(o.sx * 1.20, o.sx, p),
        lerp(o.sy * 0.78, o.sy, p),
        lerp(o.sz * 1.20, o.sz, p),
      );
      mesh.rotation.x = lerp(o.rx - 0.30, o.rx, p);
      mesh.position.y = lerp(o.py - 0.07, o.py, p);
    }
  },

  // ── CAST ───────────────────────────────────────────────────────────────────
  // Lift upward + uniform scale pulse (gathering power), then float back.
  // Distinct from attack: vertical lift signals spellcasting vs. physical hit.
  cast(mesh, t, o) {
    if (t < 0.40) {
      // Build-up: rise and expand
      const p = easeOut(t / 0.40);
      mesh.scale.set(
        lerp(o.sx, o.sx * 1.18, p),
        lerp(o.sy, o.sy * 1.24, p),
        lerp(o.sz, o.sz * 1.18, p),
      );
      mesh.position.y = lerp(o.py, o.py + 0.24, p);
      mesh.rotation.x = lerp(o.rx, o.rx - 0.20, p);
    } else {
      // Settle: ease back to original
      const p = easeOut((t - 0.40) / 0.60);
      mesh.scale.set(
        lerp(o.sx * 1.18, o.sx, p),
        lerp(o.sy * 1.24, o.sy, p),
        lerp(o.sz * 1.18, o.sz, p),
      );
      mesh.position.y = lerp(o.py + 0.24, o.py, p);
      mesh.rotation.x = lerp(o.rx - 0.20, o.rx, p);
    }
  },

  // ── HIT ────────────────────────────────────────────────────────────────────
  // Squash/stretch on impact + Z-axis wobble tilt, spring back.
  // Position X/Z intentionally untouched — enemy moves during this window.
  hit(mesh, t, o) {
    const pp = pingPong(t);                  // 0 → 1 → 0 bell curve
    mesh.scale.set(
      o.sx * (1.0 + pp * 0.34),             // widen on impact
      o.sy * (1.0 - pp * 0.42),             // compress height
      o.sz * (1.0 + pp * 0.34),
    );
    // Tilt wobble around Z — gives impression of staggering
    mesh.rotation.z = o.rz + Math.sin(t * Math.PI * 1.6) * 0.22;
    // Slight upward jolt then settle
    mesh.position.y = o.py + pp * 0.10;
  },

  // ── DEATH ──────────────────────────────────────────────────────────────────
  // Flatten height to 0 while spreading outward (squash into floor).
  // Forces mesh visible during the animation — Enemy.takeDamage() hides it
  // immediately, so we override that until the collapse completes.
  death(mesh, t, o) {
    mesh.visible = true;                             // override instant-hide
    const p = easeOut(t);
    mesh.scale.set(
      o.sx * (1.0 + p * 0.80),                      // spread outward
      o.sy * Math.max(0.001, 1.0 - p),              // collapse height (never 0 until end)
      o.sz * (1.0 + p * 0.80),
    );
    // Sink the mesh so the top sinks into the floor, not the bottom floating up
    // (pivot is at mesh centre, so halving Y scale raises the bottom by ~0.3)
    mesh.position.y = o.py * (1.0 - p * 0.90);
  },

  // ── PARRY ──────────────────────────────────────────────────────────────────
  // Hunker down + lean forward into defensive stance, then recover.
  // The forward lean (rotation.x +) reads as "bracing" vs. attack's lean back.
  parry(mesh, t, o) {
    const pp = pingPong(t);
    mesh.scale.set(
      o.sx * lerp(1.0, 1.18, pp),
      o.sy * lerp(1.0, 0.78, pp),
      o.sz * lerp(1.0, 1.18, pp),
    );
    mesh.rotation.x = lerp(o.rx, o.rx + 0.24, pp);
    mesh.position.y = lerp(o.py, o.py - 0.06, pp);
  },
};

// ── AnimationSystem ───────────────────────────────────────────────────────────

export class AnimationSystem {
  constructor() {
    // entityId → { mesh, orig, elapsed, duration, applyFn, type }
    this._active   = new Map();
    this._registry = null;
    this._eventBus = null;
    this._player   = null;
    this._debug    = false;
    this._bound    = false;   // prevents double-subscribe on zone reload
    this._idleTime = 0;       // drives player idle breathing
    this._unsubs   = [];      // unsubscribe functions from eventBus.on()
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Wire the player reference.  Call once from main.js before first zone load. */
  setContext({ player }) {
    this._player = player;
  }

  /**
   * Called by SystemManager on each zone load.
   * Updates registry reference and subscribes to events (once, guarded).
   */
  init(_zone, registry, eventBus) {
    this._active.clear();  // discard any in-flight animations from previous zone
    this._registry = registry;

    if (!this._bound) {
      this._eventBus = eventBus;
      this._bindEvents();
      this._bound = true;
    }
  }

  onEvent() {}   // required by SystemManager interface

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Play an animation on an entity.
   *
   * @param {string} entityId  'player' or an enemy id (e.g. 'e_01')
   * @param {string} animType  'attack' | 'cast' | 'hit' | 'death' | 'parry'
   */
  play(entityId, animType) {
    const mesh    = this._getMesh(entityId);
    const applyFn = APPLY[animType];
    if (!mesh || !applyFn) {
      if (this._debug) console.warn(`[Anim] Cannot play "${animType}" on "${entityId}"`);
      return;
    }

    // Cancel any in-progress animation, resetting the mesh cleanly
    const prev = this._active.get(entityId);
    if (prev && prev.type !== 'death') {
      // Don't reset a death animation that's mid-collapse — just let it finish
      resetToOrig(prev.mesh, prev.orig);
    }

    this._active.set(entityId, {
      mesh,
      orig:     snapOrig(mesh),
      elapsed:  0,
      duration: DUR[animType] ?? 0.15,
      applyFn,
      type:     animType,
    });

    if (this._debug) console.log(`[Anim] play "${animType}" on "${entityId}"`);
  }

  /** Called each frame by SystemManager. */
  update(delta) {
    // ── Active animations ──────────────────────────────────────────────────
    for (const [entityId, anim] of this._active) {
      anim.elapsed += delta;
      const t = Math.min(anim.elapsed / anim.duration, 1.0);

      anim.applyFn(anim.mesh, t, anim.orig);

      if (t >= 1.0) {
        if (anim.type === 'death') {
          anim.mesh.visible = false;          // collapse complete — hide
        } else {
          resetToOrig(anim.mesh, anim.orig);  // clean exact reset
        }
        this._active.delete(entityId);
      }
    }

    // ── Player idle breathing ──────────────────────────────────────────────
    // Continuous subtle Y-scale oscillation — only when no anim is running.
    this._idleTime += delta;
    if (this._player?.mesh && !this._active.has('player')) {
      this._player.mesh.scale.y = 1.0 + Math.sin(this._idleTime * 1.8) * 0.012;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _getMesh(entityId) {
    if (entityId === 'player') return this._player?.mesh ?? null;
    return this._registry?.getEntityById(entityId)?.mesh ?? null;
  }

  _bindEvents() {
    const eb = this._eventBus;
    if (!eb) return;

    // ── skill_cast — emitted by AbilitySystem.activate() ──────────────────
    // Payload carries animationType straight from the ability definition, so
    // the animationSystem doesn't need to know specific ability IDs.
    this._unsubs.push(eb.on('skill_cast', ({ payload }) => {
      const type     = payload?.animationType ?? 'attack';
      const entityId = payload?.entityId ?? 'player';
      this.play(entityId, type);
    }));

    // ── attack_started { source:'auto' } — emitted by CombatSystem ────────
    // Auto-attacks (click) don't go through AbilitySystem, so this is the
    // only hook for the basic melee lunge.  Ability attack_started events
    // have no source field and are intentionally ignored here (handled above
    // via skill_cast so there's no double-play).
    this._unsubs.push(eb.on('attack_started', ({ payload }) => {
      if (payload?.source === 'auto') this.play('player', 'attack');
    }));

    // ── enemy_damaged — play hit reaction on the target ────────────────────
    this._unsubs.push(eb.on('enemy_damaged', ({ payload }) => {
      const id = payload?.enemyId;
      if (id) this.play(id, 'hit');
    }));

    // ── enemy_killed — collapse the dead enemy ─────────────────────────────
    this._unsubs.push(eb.on('enemy_killed', ({ payload }) => {
      const id = payload?.enemyId ?? payload?.id;
      if (id) this.play(id, 'death');
    }));
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  /** Toggle verbose logging. */
  setDebug(on = true) {
    this._debug = on;
    console.log(`[Anim] Debug ${on ? 'ON' : 'OFF'}`);
  }

  /** Dump all active animations to console. */
  inspect() {
    console.group(`[AnimationSystem] active: ${this._active.size}`);
    for (const [id, anim] of this._active) {
      const pct = Math.round((anim.elapsed / anim.duration) * 100);
      console.log(`  "${id}" → ${anim.type}  ${pct}%`);
    }
    if (this._active.size === 0) console.log('  (none)');
    console.groupEnd();
  }

  /**
   * Manually trigger an animation — useful from the debug console.
   *
   * @example
   *   __debug.anim.trigger('player', 'cast')
   *   __debug.anim.trigger('enemy_01', 'hit')
   */
  trigger(entityId, animType) {
    this.play(entityId, animType);
    console.log(`[Anim] triggered "${animType}" on "${entityId}"`);
  }

  /**
   * Trigger an animation on ALL currently living enemies — handy for testing.
   *
   * @example  __debug.anim.triggerEnemies('hit')
   */
  triggerEnemies(animType) {
    const enemies = this._registry?.getEntitiesByType('enemy') ?? [];
    let count = 0;
    for (const e of enemies) {
      if (e.alive) { this.play(e.id, animType); count++; }
    }
    console.log(`[Anim] triggered "${animType}" on ${count} enemies`);
  }
}
