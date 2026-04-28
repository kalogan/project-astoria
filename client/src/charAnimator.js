// charAnimator.js — Component-based per-part animation system.
//
// Animates character part meshes for continuous states (idle, walk) and
// one-shot reactions (attack, hit).
//
// ── RELATIONSHIP TO animationSystem.js ───────────────────────────────────────
//   animationSystem.js  → event-driven root-mesh squash/stretch (attack, hit, death)
//   charAnimator.js     → continuous GROUP-level bob/sway + per-part weapon lunge
//   They target different objects and run in parallel — no conflict.
//
// ── WHAT IS ANIMATED ────────────────────────────────────────────────────────
//   Idle / Walk   → partsGroup.position.y  (whole character bobs)
//                   partsGroup.rotation.z  (side lean on walk)
//   Attack        → last-child (weapon) position.z thrust
//                   upper-half parts rotation.x lean-in
//   Hit           → partsGroup.rotation.z  (stagger tilt)
//                   partsGroup.position.z  (knockback lurch)
//
//   Animating the GROUP rather than every individual child gives clearly
//   readable motion at the isometric camera's zoom level (frustum ≈ 13).
//
// ── PART TARGETING ────────────────────────────────────────────────────────────
//   Player:  entity.mesh  →  _charParts (named child Group)  →  .children[]
//   Enemy:   entity.mesh  IS  the parts group                →  .children[]
//   Shadow disc is children[0] (userData.isShadow — skipped for per-part anims).
//
// ── STATE MACHINE (per entity, per frame) ─────────────────────────────────────
//   Priority:  once-shot (hit / attack)  >  walk (if moving)  >  idle
//   Moving:    player  — WASD key held
//              enemy   — path.length > 0
//
// ── REST POSES ────────────────────────────────────────────────────────────────
//   Captured when AnimComp is first created.
//   Group-level rest: partsGroup.position.{y,z}, rotation.z
//   Part-level rest:  each child position + rotation (for attack/hit per-part)
//   On once-shot completion all transforms are reset exactly — zero drift.

// ── Math helpers ──────────────────────────────────────────────────────────────
function lerp(a, b, t)  { return a + (b - a) * t; }
function easeOut(t)     { return 1 - (1 - t) * (1 - t); }

// ─────────────────────────────────────────────────────────────────────────────
// Animation Library
// ─────────────────────────────────────────────────────────────────────────────
// Loop anims:  { hz, apply(comp, phase) }
// Once anims:  { duration, apply(comp, t) }
//
// comp is the AnimComp — access comp.pg (partsGroup), comp.parts, comp.restG,
// comp.restPoses as needed.

const ANIMS = {

  // ── IDLE — subtle standing breath ─────────────────────────────────────────
  // Group bobs ±0.025 units (~1.5 px at frustum 13).  Barely noticeable when
  // standing still, but proves the system is alive.
  idle: {
    hz: 1.4,
    apply(comp, phase) {
      const r = comp.restG;
      comp.pg.position.y = r.py + Math.sin(phase) * 0.025;
    },
  },

  // ── WALK — pronounced bounce + lean ─────────────────────────────────────
  // Math.abs(sin) = "double bounce" = two footfall pulses per cycle.
  // At hz 3.2 and player speed 5 the bob rate matches the visual stride.
  // Bob 0.14 units ≈ 8-9 px; lean ±0.13 rad ≈ 7° — clearly readable.
  walk: {
    hz: 3.2,
    apply(comp, phase) {
      const r = comp.restG;
      // Double-bounce: peak twice per cycle (left step + right step)
      const bob  = Math.abs(Math.sin(phase)) * 0.14 - 0.035;
      const lean = Math.sin(phase) * 0.13;
      comp.pg.position.y = r.py + bob;
      comp.pg.rotation.z = r.rz + lean;
    },
  },

  // ── ATTACK — weapon punches forward, body leans in ───────────────────────
  // Last non-shadow child = weapon (staff / blade / axe).
  // Wind-up (35%) then snap-back with ease-out (65%).
  attack: {
    duration: 0.22,
    apply(comp, t) {
      const parts = comp.parts;
      const rest  = comp.restPoses;
      if (parts.length < 2) return;

      // Weapon index = last non-shadow part
      let wi = parts.length - 1;
      while (wi > 0 && parts[wi].userData.isShadow) wi--;

      // Weapon thrust forward (−Z in local space)
      const thrust = t < 0.35
        ? lerp(0, -0.28, t / 0.35)
        : lerp(-0.28, 0, easeOut((t - 0.35) / 0.65));
      parts[wi].position.z = rest[wi].z + thrust;

      // Upper-half parts: lean rx into the swing
      const mid = Math.max(1, Math.floor(parts.length * 0.45));
      for (let i = mid; i < wi; i++) {
        const lean = t < 0.35
          ? lerp(0, -0.18, t / 0.35)
          : lerp(-0.18, 0, easeOut((t - 0.35) / 0.65));
        parts[i].rotation.x = rest[i].rx + lean;
      }

      // Whole group shifts slightly forward on wind-up
      const grp = t < 0.35
        ? lerp(0, -0.08, t / 0.35)
        : lerp(-0.08, 0, easeOut((t - 0.35) / 0.65));
      comp.pg.position.z = comp.restG.pz + grp;
    },
  },

  // ── HIT — stagger: whole group lurches back then rights itself ────────────
  // Bell-curve (sin π·t): smooth enter and exit.
  // Lurch backward +Z, tilt ±rz to simulate stagger direction.
  hit: {
    duration: 0.20,
    apply(comp, t) {
      const bell = Math.sin(t * Math.PI);
      const r = comp.restG;
      comp.pg.position.z = r.pz + bell * 0.14;       // lurch back
      comp.pg.rotation.z = r.rz + bell * -0.22;      // stagger tilt
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AnimComp — per-entity animation component
// ─────────────────────────────────────────────────────────────────────────────

class AnimComp {
  constructor(partsGroup) {
    this.pg           = partsGroup;
    this.parts        = partsGroup.children;   // live — never replaced mid-run
    this.restG        = null;   // group-level rest: { py, pz, rz }
    this.restPoses    = [];     // per-part rest: [{ x,y,z, rx,ry,rz }, ...]
    this.phase        = 0;
    this.onceAnim     = null;
    this.onceTimer    = 0;
    this.onceDuration = 0;
    this._prevHz      = -1;
    this._captureRest();
  }

  _captureRest() {
    const pg = this.pg;
    this.restG = {
      py: pg.position.y,
      pz: pg.position.z,
      rz: pg.rotation.z,
    };
    this.restPoses = this.parts.map(p => ({
      x:  p.position.x, y:  p.position.y, z:  p.position.z,
      rx: p.rotation.x, ry: p.rotation.y, rz: p.rotation.z,
    }));
  }

  _resetToRest() {
    const r = this.restG;
    this.pg.position.y = r.py;
    this.pg.position.z = r.pz;
    this.pg.rotation.z = r.rz;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const rp = this.restPoses[i];
      if (!p || !rp) continue;
      p.position.set(rp.x, rp.y, rp.z);
      p.rotation.set(rp.rx, rp.ry, rp.rz);
    }
  }

  triggerOnce(animKey) {
    const anim = ANIMS[animKey];
    if (!anim || anim.duration === undefined) return;
    this._resetToRest();
    this.onceAnim     = anim;
    this.onceTimer    = 0;
    this.onceDuration = anim.duration;
  }

  tick(delta, isMoving) {
    // ── One-shot priority ──────────────────────────────────────────────────
    if (this.onceAnim) {
      this.onceTimer += delta;
      const t = Math.min(this.onceTimer / this.onceDuration, 1.0);
      this.onceAnim.apply(this, t);
      if (t >= 1.0) {
        this._resetToRest();
        this.onceAnim = null;
      }
      return;
    }

    // ── Loop: walk or idle ─────────────────────────────────────────────────
    const anim  = isMoving ? ANIMS.walk : ANIMS.idle;
    const newHz = anim.hz;

    // Reset phase on state switch to prevent position pop
    if (this._prevHz !== newHz) {
      this._resetToRest();
      this.phase = 0;
    }
    this._prevHz = newHz;

    this.phase += delta * newHz * Math.PI * 2;
    anim.apply(this, this.phase);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CharAnimator — system class (registered with SystemManager)
// ─────────────────────────────────────────────────────────────────────────────

export class CharAnimator {
  constructor() {
    this._comps    = new Map();   // entityId → AnimComp
    this._registry = null;
    this._player   = null;
    this._eventBus = null;
    this._bound    = false;
    this._debug    = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setContext({ player }) {
    this._player = player;
  }

  init(_zone, registry, eventBus) {
    this._registry = registry;
    // Drop all enemy comps (new zone = new enemies).
    // Player comp is validated by reference check in _getOrCreate.
    for (const id of [...this._comps.keys()]) {
      if (id !== 'player') this._comps.delete(id);
    }
    if (!this._bound) {
      this._eventBus = eventBus;
      this._bindEvents();
      this._bound = true;
    }
  }

  onEvent() {}   // required by SystemManager

  // ── Update ─────────────────────────────────────────────────────────────────

  update(delta) {
    // Player
    if (this._player) {
      const comp = this._getOrCreate('player', this._player.mesh);
      if (comp) {
        const k = this._player.keys;
        const isMoving = !!(k?.w || k?.a || k?.s || k?.d);
        comp.tick(delta, isMoving);
      }
    }

    // Enemies
    if (!this._registry) return;
    for (const e of this._registry.getEntitiesByType('enemy')) {
      if (!e.alive) continue;
      const comp = this._getOrCreate(e.id, e.mesh);
      if (!comp) continue;
      comp.tick(delta, (e.path?.length ?? 0) > 0);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Trigger a one-shot animation (attack | hit) on any entity id. */
  trigger(entityId, animKey) {
    const comp = this._comps.get(entityId);
    if (comp) {
      comp.triggerOnce(animKey);
      if (this._debug) console.log(`[CharAnim] "${animKey}" → "${entityId}"`);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _getOrCreate(entityId, mesh) {
    const existing = this._comps.get(entityId);
    if (existing) {
      // Invalidate if player changed class (new _charParts reference)
      if (existing.pg === _getPartsGroup(mesh)) return existing;
      this._comps.delete(entityId);
    }

    const pg = _getPartsGroup(mesh);
    if (!pg || pg.children.length === 0) return null;

    const comp = new AnimComp(pg);
    this._comps.set(entityId, comp);
    if (this._debug) console.log(`[CharAnim] registered "${entityId}" (${pg.children.length} parts)`);
    return comp;
  }

  _bindEvents() {
    const eb = this._eventBus;
    if (!eb) return;
    eb.on('attack_started', ({ payload }) => {
      if (payload?.source === 'auto') this.trigger('player', 'attack');
    });
    eb.on('skill_cast', ({ payload }) => {
      this.trigger(payload?.entityId ?? 'player', 'attack');
    });
    eb.on('enemy_damaged', ({ payload }) => {
      if (payload?.enemyId) this.trigger(payload.enemyId, 'hit');
    });
    eb.on('player_damaged', () => {
      this.trigger('player', 'hit');
    });
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setDebug(on = true) { this._debug = on; console.log(`[CharAnim] debug ${on ? 'ON' : 'OFF'}`); }

  inspect() {
    console.group(`[CharAnimator] comps: ${this._comps.size}`);
    for (const [id, comp] of this._comps) {
      const state = comp.onceAnim ? 'once' : (comp._prevHz === ANIMS.walk.hz ? 'walk' : 'idle');
      console.log(`  "${id}"  state=${state}  phase=${comp.phase.toFixed(2)}  parts=${comp.parts.length}`);
    }
    console.groupEnd();
  }

  test(entityId = 'player', animKey = 'hit') {
    this.trigger(entityId, animKey);
    console.log(`[CharAnim] test "${animKey}" on "${entityId}"`);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Get the Group containing animatable part children.
 *  Player wraps them in a named _charParts child; enemies expose them directly. */
function _getPartsGroup(mesh) {
  if (!mesh) return null;
  return mesh.getObjectByName('_charParts') ?? mesh;
}
