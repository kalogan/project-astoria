// statusVisualSystem.js — in-world visual indicators for status effects.
//
// Attaches simple Three.js meshes to entities to communicate active effects:
//
//   stun    → spinning yellow ring orbiting the entity (Y-axis rotation)
//   slow    → blue material tint on entity mesh
//   burn    → red/orange material flicker
//   weaken  → purple material tint
//
// Material tints store the original color and restore it on removal.
// Tint and ring visuals are mutually exclusive per slot — only the highest-
// priority effect tints the mesh at any time.
//
// Events: 'status_applied', 'status_removed'
// Follows entity position every frame for ring indicators.

import * as THREE from 'three';

// Priority order — higher overwrites lower for mesh tint
const TINT_PRIORITY = { stun: 3, weaken: 2, burn: 1, slow: 0 };

const TINT_COLORS = {
  slow:   0x4fc3f7,  // pale blue
  burn:   0xff6600,  // orange-red
  weaken: 0x9b59b6,  // purple
};

// Burn flicker: oscillates mesh color between base and orange
const BURN_COLORS = [0xff6600, 0xff3300, 0xcc4400];

export class StatusVisualSystem {
  constructor(scene) {
    this._scene    = scene;
    this._registry = null;
    this._eventBus = null;
    this._player   = null;
    this._enabled  = true;
    this._debug    = false;
    this._bound    = false;
    this._time     = 0;

    // entityId → Map<effectId, VisualState>
    // VisualState: { ring?, origColor?, tintEffectId?, flickerTimer? }
    this._indicators = new Map();
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
    this._time += delta;

    for (const [entityId, effects] of this._indicators) {
      const mesh = this._getMesh(entityId);
      if (!mesh) continue;

      for (const [effectId, vis] of effects) {
        // Rotate stun ring
        if (vis.ring) {
          vis.ring.position.copy(mesh.position);
          vis.ring.position.y = mesh.position.y + 0.5;
          vis.ring.rotation.y += delta * 3.0;  // spin ~3 rad/s
        }

        // Burn flicker — oscillate mesh color
        if (effectId === 'burn' && vis.isTinting && mesh.material?.color) {
          const phase = Math.sin(this._time * 12) * 0.5 + 0.5;  // ~6 Hz flicker
          const c     = new THREE.Color(0xff6600).lerp(new THREE.Color(0xff2200), phase);
          mesh.material.color.copy(c);
        }
      }
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _bindEvents() {
    const eb = this._eventBus;
    if (!eb) return;

    eb.on('status_applied', ({ payload }) => {
      if (!this._enabled) return;
      const { targetId, effectId } = payload ?? {};
      if (!targetId || !effectId) return;
      this._applyVisual(targetId, effectId);
      if (this._debug) console.log(`[StatusVis] apply "${effectId}" → "${targetId}"`);
    });

    eb.on('status_removed', ({ payload }) => {
      if (!this._enabled) return;
      const { targetId, effectId } = payload ?? {};
      if (!targetId || !effectId) return;
      this._removeVisual(targetId, effectId);
      if (this._debug) console.log(`[StatusVis] remove "${effectId}" ← "${targetId}"`);
    });
  }

  _applyVisual(entityId, effectId) {
    const mesh = this._getMesh(entityId);
    if (!mesh) return;

    if (!this._indicators.has(entityId)) this._indicators.set(entityId, new Map());
    const effects = this._indicators.get(entityId);
    if (effects.has(effectId)) return;  // already showing

    const vis = {};

    if (effectId === 'stun') {
      // Spinning ring above the entity
      const geo = new THREE.TorusGeometry(0.5, 0.06, 5, 20);
      const mat = new THREE.MeshBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 0.85 });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.copy(mesh.position);
      ring.position.y += 0.5;
      this._scene?.add(ring);
      vis.ring = ring;
    }

    // Mesh color tint (slow, burn, weaken)
    const tintColor = TINT_COLORS[effectId];
    if (tintColor !== undefined && mesh.material?.color) {
      const priority = TINT_PRIORITY[effectId] ?? 0;
      const currentPriority = this._currentTintPriority(effects);
      if (priority >= currentPriority) {
        // Store original color only once
        if (!this._hasAnyTint(effects)) {
          vis.origColor = mesh.material.color.getHex();
        }
        mesh.material.color.setHex(tintColor);
        vis.isTinting = true;
        // Mark any lower-priority tints as dormant
        for (const [, v] of effects) v.isTinting = false;
        vis.isTinting = true;
      }
    }

    effects.set(effectId, vis);
  }

  _removeVisual(entityId, effectId) {
    const effects = this._indicators.get(entityId);
    if (!effects) return;

    const vis = effects.get(effectId);
    if (!vis) return;

    // Remove ring
    if (vis.ring) {
      this._scene?.remove(vis.ring);
      vis.ring = null;
    }

    // Restore mesh color
    if (vis.isTinting) {
      const mesh = this._getMesh(entityId);
      effects.delete(effectId);

      // Find next-highest tint to activate, or restore original
      const remaining = [...effects.values()].filter(v => TINT_COLORS[v.effectId] !== undefined);
      if (remaining.length === 0 && mesh?.material?.color && vis.origColor !== undefined) {
        mesh.material.color.setHex(vis.origColor);
      } else if (remaining.length > 0 && mesh?.material?.color) {
        // Re-apply highest remaining tint
        let best = null, bestP = -1;
        for (const [eid] of effects) {
          const p = TINT_PRIORITY[eid] ?? 0;
          if (p > bestP && TINT_COLORS[eid] !== undefined) { best = eid; bestP = p; }
        }
        if (best) {
          mesh.material.color.setHex(TINT_COLORS[best]);
          effects.get(best).isTinting = true;
        }
      }
      return; // already deleted above
    }

    effects.delete(effectId);
    if (effects.size === 0) this._indicators.delete(entityId);
  }

  _currentTintPriority(effects) {
    let best = -1;
    for (const [id, v] of effects) if (v.isTinting) best = Math.max(best, TINT_PRIORITY[id] ?? 0);
    return best;
  }

  _hasAnyTint(effects) {
    for (const [, v] of effects) if (v.isTinting) return true;
    return false;
  }

  _getMesh(entityId) {
    if (entityId === 'player') return this._player?.mesh ?? null;
    return this._registry?.getEntityById(entityId)?.mesh ?? null;
  }

  _clearAll() {
    for (const [entityId, effects] of this._indicators) {
      for (const [effectId] of effects) this._removeVisual(entityId, effectId);
    }
    this._indicators.clear();
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setEnabled(on = true) { this._enabled = on; }
  toggle()              { this._enabled = !this._enabled; }
  setDebug(on = true)   { this._debug = on; }

  inspect() {
    console.group('[StatusVis]');
    for (const [id, m] of this._indicators) {
      console.log(`  "${id}": ${[...m.keys()].join(', ')}`);
    }
    if (this._indicators.size === 0) console.log('  (none)');
    console.groupEnd();
  }

  /** Manually test a visual: __debug.statusvis.test('player', 'burn') */
  test(entityId, effectId) {
    this._applyVisual(entityId, effectId);
    setTimeout(() => this._removeVisual(entityId, effectId), 2000);
    console.log(`[StatusVis] testing "${effectId}" on "${entityId}" for 2s`);
  }
}
