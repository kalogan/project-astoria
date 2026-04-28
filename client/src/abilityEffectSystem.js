// abilityEffectSystem.js — per-skill visual effects.
//
// Distinct from hitEffectSystem (impact reactions) — this system creates the
// offensive visual for each ability *at the moment of cast*:
//
//   Warrior  — grounded, physical: sweep arcs, expanding discs, impact marks
//   Mage     — magical, ranged:    glowing spheres, expanding rings, nova pulse
//
// Each skill maps to an EFFECT_DEFS entry.  The entry has:
//   create(scene, pos, registry, player)  → Effect object
//   update(effect, t)                     → animate at progress t[0..1]
//
// Lifecycle: spawn → update each frame → remove at t=1.
// Effects manage their own Three.js objects and clean up in `destroy()`.
// Active effects are stored in _active array; each is ticked in update(delta).
//
// The system listens to 'skill_cast' events.  It uses `payload.abilityId` to
// look up the effect definition.  entityId in the payload identifies the caster
// (player or enemy) to position the effect correctly.

import * as THREE from 'three';

// ── Shared materials (created once, reused per-color) ─────────────────────────
const _mats = {};
function _mat(color, opacity = 1.0) {
  const key = `${color}_${opacity}`;
  if (!_mats[key]) {
    _mats[key] = new THREE.MeshBasicMaterial({
      color, transparent: opacity < 1, opacity,
      side: THREE.DoubleSide, depthWrite: false,
    });
  }
  return _mats[key];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t)    { return 1 - (1 - t) * (1 - t); }

// ── Per-ability effect factories ──────────────────────────────────────────────
// create() returns a plain object: { meshes[], update(t), duration, destroy() }

const EFFECT_DEFS = {

  // ── SLASH / SURROUND HIT ──────────────────────────────────────────────────
  // Four arc marks spread radially on the ground — quick orange flash.
  slash: {
    duration: 0.28,
    create(scene, pos) {
      const meshes = [];
      for (let i = 0; i < 4; i++) {
        const a   = (i / 4) * Math.PI * 2;
        const geo = new THREE.BoxGeometry(0.06, 0.01, 1.4);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.9 });
        const m   = new THREE.Mesh(geo, mat);
        m.rotation.y = a;
        m.position.set(pos.x, 0.08, pos.z);
        scene.add(m);
        meshes.push({ m, mat, a });
      }
      return {
        meshes,
        update(t) {
          const scale = lerp(0.7, 1.4, easeOut(t));
          for (const { m, mat } of meshes) {
            m.scale.set(1, 1, scale);
            mat.opacity = 1.0 - t;
          }
        },
        destroy() { for (const { m } of meshes) scene.remove(m); },
      };
    },
  },

  // ── WAR CRY ────────────────────────────────────────────────────────────────
  // Large expanding flat disc on ground — physical shockwave.
  war_cry: {
    duration: 0.32,
    create(scene, pos) {
      const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.85 });
      const m   = new THREE.Mesh(geo, mat);
      m.position.set(pos.x, 0.04, pos.z);
      scene.add(m);
      return {
        meshes: [{ m, mat }],
        update(t) {
          const s = lerp(0.5, 5.0, easeOut(t));
          m.scale.set(s, 1, s);
          mat.opacity = (1 - t) * 0.75;
        },
        destroy() { scene.remove(m); },
      };
    },
  },

  // ── CHARGE ─────────────────────────────────────────────────────────────────
  // Impact star at target position — bright red burst.
  charge: {
    duration: 0.22,
    create(scene, pos, registry, player) {
      // Place at nearest enemy, fallback to pos
      let target = pos;
      if (registry && player) {
        let best = null, bestD = 64;
        for (const e of registry.getEntitiesByType('enemy')) {
          if (!e.alive) continue;
          const dx = e.mesh.position.x - player.mesh.position.x;
          const dz = e.mesh.position.z - player.mesh.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) { best = e; bestD = d2; }
        }
        if (best) target = best.mesh.position;
      }
      const geo = new THREE.SphereGeometry(0.35, 8, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 1 });
      const m   = new THREE.Mesh(geo, mat);
      m.position.set(target.x, 0.55, target.z);
      scene.add(m);
      return {
        meshes: [{ m, mat }],
        update(t) {
          m.scale.setScalar(lerp(1.0, 2.2, easeOut(t)));
          mat.opacity = 1.0 - t;
        },
        destroy() { scene.remove(m); },
      };
    },
  },

  // ── PARRY ──────────────────────────────────────────────────────────────────
  // Golden pulsing ring — defensive shield flash around player.
  parry: {
    duration: 0.35,
    create(scene, pos) {
      const geo = new THREE.TorusGeometry(0.55, 0.06, 6, 24);
      const mat = new THREE.MeshBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 1 });
      const m   = new THREE.Mesh(geo, mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(pos.x, 0.55, pos.z);
      scene.add(m);
      return {
        meshes: [{ m, mat }],
        update(t) {
          m.scale.setScalar(lerp(1.0, 1.6, easeOut(t)));
          mat.opacity = (1 - t) * 0.9;
        },
        destroy() { scene.remove(m); },
      };
    },
  },

  // ── BACKSTAB ───────────────────────────────────────────────────────────────
  // Dark slash flash at target.
  backstab: {
    duration: 0.20,
    create(scene, pos, registry, player) {
      let target = pos;
      if (registry && player) {
        let best = null, bestD = 16;
        for (const e of registry.getEntitiesByType('enemy')) {
          if (!e.alive) continue;
          const dx = e.mesh.position.x - player.mesh.position.x;
          const dz = e.mesh.position.z - player.mesh.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) { best = e; bestD = d2; }
        }
        if (best) target = best.mesh.position;
      }
      const meshes = [];
      for (let i = 0; i < 3; i++) {
        const a   = (i / 3) * Math.PI;
        const geo = new THREE.BoxGeometry(0.04, 0.01, 0.9);
        const mat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.85 });
        const m   = new THREE.Mesh(geo, mat);
        m.rotation.y = a;
        m.position.set(target.x, 0.3, target.z);
        scene.add(m);
        meshes.push({ m, mat });
      }
      return {
        meshes,
        update(t) { for (const { m, mat } of meshes) { m.scale.setScalar(lerp(1, 1.5, t)); mat.opacity = 1 - t; } },
        destroy() { for (const { m } of meshes) scene.remove(m); },
      };
    },
  },

  // ── FIREBALL ───────────────────────────────────────────────────────────────
  // Expanding orange sphere at target — warm explosion.
  fireball: {
    duration: 0.30,
    create(scene, pos, registry, player) {
      let target = pos;
      if (registry && player) {
        let best = null, bestD = 200;
        for (const e of registry.getEntitiesByType('enemy')) {
          if (!e.alive) continue;
          const dx = e.mesh.position.x - player.mesh.position.x;
          const dz = e.mesh.position.z - player.mesh.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) { best = e; bestD = d2; }
        }
        if (best) target = best.mesh.position;
      }
      const geo  = new THREE.SphereGeometry(0.4, 10, 6);
      const mat  = new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 1 });
      const m    = new THREE.Mesh(geo, mat);
      m.position.set(target.x, 0.6, target.z);
      scene.add(m);

      // Inner core: brighter yellow
      const geoC = new THREE.SphereGeometry(0.22, 8, 4);
      const matC = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 1 });
      const mC   = new THREE.Mesh(geoC, matC);
      mC.position.copy(m.position);
      scene.add(mC);

      return {
        meshes: [{ m, mat }, { m: mC, mat: matC }],
        update(t) {
          const s = lerp(0.5, 2.8, easeOut(t));
          m.scale.setScalar(s);
          mC.scale.setScalar(s * 0.55);
          mat.opacity  = (1 - t) * 0.9;
          matC.opacity = 1 - t;
        },
        destroy() { scene.remove(m); scene.remove(mC); },
      };
    },
  },

  // ── MAGIC MISSILE ──────────────────────────────────────────────────────────
  // Fast-travel glowing sphere from caster to target.
  magic_missile: {
    duration: 0.24,
    create(scene, pos, registry, player) {
      const start = player ? { ...player.mesh.position } : { ...pos };
      let end = pos;
      if (registry && player) {
        let best = null, bestD = 200;
        for (const e of registry.getEntitiesByType('enemy')) {
          if (!e.alive) continue;
          const dx = e.mesh.position.x - start.x;
          const dz = e.mesh.position.z - start.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) { best = e; bestD = d2; }
        }
        if (best) end = best.mesh.position;
      }
      const geo = new THREE.SphereGeometry(0.16, 8, 5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x74b9ff, transparent: true, opacity: 1 });
      const m   = new THREE.Mesh(geo, mat);
      m.position.set(start.x, start.y + 0.5, start.z);
      scene.add(m);
      return {
        meshes: [{ m, mat }],
        update(t) {
          const te = easeOut(t);
          m.position.set(
            lerp(start.x, end.x, te),
            lerp(start.y + 0.5, (end.y ?? 0.6) + 0.2, te),
            lerp(start.z, end.z, te),
          );
          const s = t < 0.8 ? 1.0 : lerp(1.0, 2.5, (t - 0.8) / 0.2);
          m.scale.setScalar(s);
          mat.opacity = t < 0.8 ? 0.95 : 1 - (t - 0.8) / 0.2;
        },
        destroy() { scene.remove(m); },
      };
    },
  },

  // ── NOVA ───────────────────────────────────────────────────────────────────
  // Large double-ring arcane burst — complements the smaller ring from abilitySystem.
  nova: {
    duration: 0.38,
    create(scene, pos) {
      const rings = [];
      for (let i = 0; i < 2; i++) {
        const r   = 0.3 + i * 0.4;
        const geo = new THREE.TorusGeometry(r, 0.07, 5, 32);
        const mat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0xa29bfe : 0x74b9ff, transparent: true, opacity: 0.9 });
        const m   = new THREE.Mesh(geo, mat);
        m.rotation.x = Math.PI / 2;
        m.position.set(pos.x, 0.12, pos.z);
        scene.add(m);
        rings.push({ m, mat, delay: i * 0.08 });
      }
      return {
        meshes: rings,
        update(t) {
          for (const { m, mat, delay } of rings) {
            const lt = Math.max(0, (t - delay) / (1 - delay));
            m.scale.setScalar(lerp(0.4, 6.5, easeOut(lt)));
            mat.opacity = (1 - lt) * 0.85;
          }
        },
        destroy() { for (const { m } of rings) scene.remove(m); },
      };
    },
  },
};

// Fallback for unknown abilities — small generic flash ring
const _fallback = {
  duration: 0.22,
  create(scene, pos) {
    const geo = new THREE.TorusGeometry(0.35, 0.05, 5, 20);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const m   = new THREE.Mesh(geo, mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(pos.x, 0.15, pos.z);
    scene.add(m);
    return {
      meshes: [{ m, mat }],
      update(t) { m.scale.setScalar(lerp(0.5, 2.0, easeOut(t))); mat.opacity = (1 - t) * 0.65; },
      destroy() { scene.remove(m); },
    };
  },
};

// ── AbilityEffectSystem ───────────────────────────────────────────────────────

export class AbilityEffectSystem {
  constructor(scene) {
    this._scene    = scene;
    this._registry = null;
    this._eventBus = null;
    this._player   = null;
    this._enabled  = true;
    this._debug    = false;
    this._bound    = false;

    // Active effect instances: { def, instance, elapsed, duration }
    this._active = [];
  }

  setContext({ scene, player }) {
    this._scene  = scene ?? this._scene;
    this._player = player;
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
    for (let i = this._active.length - 1; i >= 0; i--) {
      const e = this._active[i];
      e.elapsed += delta;
      const t = Math.min(e.elapsed / e.duration, 1.0);
      e.instance.update(t);
      if (t >= 1.0) {
        e.instance.destroy();
        this._active.splice(i, 1);
      }
    }
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  spawnEffect(abilityId, entityId) {
    if (!this._enabled || !this._scene) return;
    const pos = this._getPos(entityId);
    if (!pos) return;

    const def  = EFFECT_DEFS[abilityId] ?? _fallback;
    const inst = def.create(this._scene, pos, this._registry, this._player);
    this._active.push({ instance: inst, elapsed: 0, duration: def.duration });

    if (this._debug) console.log(`[AbilFX] spawn "${abilityId}" at`, pos);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _getPos(entityId) {
    if (!entityId || entityId === 'player') return this._player?.mesh?.position ?? null;
    return this._registry?.getEntityById(entityId)?.mesh?.position ?? null;
  }

  _bindEvents() {
    const eb = this._eventBus;
    if (!eb) return;

    eb.on('skill_cast', ({ payload }) => {
      if (!this._enabled) return;
      const abilityId = payload?.abilityId;
      const entityId  = payload?.entityId ?? 'player';
      if (abilityId) this.spawnEffect(abilityId, entityId);
    });
  }

  _clearAll() {
    for (const e of this._active) e.instance.destroy();
    this._active = [];
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  setEnabled(on = true) { this._enabled = on; }
  toggle()              { this._enabled = !this._enabled; }
  setDebug(on = true)   { this._debug = on; }

  inspect() {
    console.log(`[AbilFX] active: ${this._active.length}`);
  }

  /** Test-spawn any effect at (x, z): __debug.abilfx.test('nova', 0, 0) */
  test(abilityId, x = 0, z = 0) {
    if (!this._scene) return;
    const def  = EFFECT_DEFS[abilityId] ?? _fallback;
    const inst = def.create(this._scene, { x, y: 0, z }, this._registry, this._player);
    this._active.push({ instance: inst, elapsed: 0, duration: def.duration });
    console.log(`[AbilFX] test "${abilityId}" at (${x}, ${z})`);
  }
}
