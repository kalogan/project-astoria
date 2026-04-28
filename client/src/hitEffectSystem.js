// hitEffectSystem.js — 3D hit flash + particle burst.
//
// Provides immediate, readable feedback for all combat damage:
//   Hit flash    — briefly tints enemy mesh white (via material.color), then restores
//   Particles    — 3–6 tiny quads scatter from impact point, fall with gravity, fade
//   Death burst  — larger particle spread for entity death
//
// Damage numbers are handled centrally in main.js via the 'enemy_damaged' event
// (hud.spawnDamageNumber).  This system is purely 3D-space effects.
//
// PERFORMANCE
//   Particle meshes are pre-allocated in a fixed pool (POOL_SIZE = 24).
//   Each pooled mesh has its own material for independent opacity control.
//   No allocations occur during gameplay — pool items are acquired/released.
//   Active effects from a previous zone are cleared in init().

import * as THREE from 'three';

const POOL_SIZE      = 24;
const FLASH_DURATION = 0.10;  // seconds
const HIT_COLOR      = 0xffffff;

export class HitEffectSystem {
  constructor(scene) {
    this._scene    = scene;
    this._registry = null;
    this._eventBus = null;
    this._player   = null;
    this._enabled  = true;
    this._debug    = false;
    this._bound    = false;

    // Pre-allocated particle pool
    this._pool     = [];   // { mesh, mat, active, life, maxLife, vx, vy, vz }
    this._flashing = [];   // { mesh, origColor, timer }

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
    this._clearAll();
    if (!this._bound) {
      this._bindEvents();
      this._bound = true;
    }
  }

  onEvent() {}

  update(delta) {
    if (!this._enabled) return;

    // Tick particles
    const scene = this._scene;
    for (const p of this._pool) {
      if (!p.active) continue;
      p.life -= delta;
      if (p.life <= 0) {
        p.active        = false;
        p.mesh.visible  = false;
        continue;
      }
      const t = 1.0 - p.life / p.maxLife;
      p.mesh.position.x += p.vx * delta;
      p.mesh.position.y += p.vy * delta;
      p.mesh.position.z += p.vz * delta;
      p.vy              -= 6.0 * delta;   // gravity — pulls quads back to floor
      p.mat.opacity      = Math.max(0, 1.0 - t * 1.2);
    }

    // Tick mesh flash
    for (let i = this._flashing.length - 1; i >= 0; i--) {
      const f = this._flashing[i];
      f.timer -= delta;
      if (f.timer <= 0) {
        if (f.mesh?.material) f.mesh.material.color.setHex(f.origColor);
        this._flashing.splice(i, 1);
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Spawn hit particles + flash at world position. */
  spawnHit(position, count = 4, color = 0xff5500) {
    if (!this._enabled) return;
    this._burst(position, count, color, 2.8, 0.35);
  }

  /** Larger burst for entity death. */
  spawnDeath(position, color = 0xff2200) {
    if (!this._enabled) return;
    this._burst(position, 8, color, 4.5, 0.60);
  }

  /** Briefly tint an entity white (hit confirmation).
   *  Works with both plain Meshes and procedural character Groups.
   *  Every non-shadow sub-mesh is flashed so the whole character reacts. */
  flashMesh(entityId) {
    if (!this._enabled) return;
    const root = this._getMesh(entityId);
    if (!root) return;

    // Collect all flashable meshes: plain Mesh → [root]; Group → all child Meshes
    // that are NOT shadow discs (isShadow flag set in characterBuilder).
    const targets = [];
    if (root.isMesh) {
      targets.push(root);
    } else {
      root.traverse(child => {
        if (child.isMesh && !child.userData.isShadow) targets.push(child);
      });
    }

    for (const mesh of targets) {
      if (!mesh.material?.color) continue;
      const origColor = mesh.material.color.getHex();
      mesh.material.color.setHex(HIT_COLOR);
      // Update existing entry rather than stacking duplicate timers
      const existing = this._flashing.find(f => f.mesh === mesh);
      if (existing) { existing.timer = FLASH_DURATION; }
      else           this._flashing.push({ mesh, origColor, timer: FLASH_DURATION });
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _initPool(scene) {
    if (!scene) return;
    const geo = new THREE.PlaneGeometry(0.16, 0.16);
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat  = new THREE.MeshBasicMaterial({
        color: 0xff5500, transparent: true, opacity: 1,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this._pool.push({ mesh, mat, active: false, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });
    }
  }

  _burst(position, count, color, speed, life) {
    const px = position.x ?? 0;
    const py = (position.y ?? 0.65) + 0.1;
    const pz = position.z ?? 0;

    for (let i = 0; i < count; i++) {
      const p = this._acquire();
      if (!p) break;

      const angle = (i / count) * Math.PI * 2 + Math.random() * 1.0;
      const radial = speed * (0.5 + Math.random() * 0.7);

      p.mat.color.setHex(color);
      p.mat.opacity  = 1.0;
      p.life         = life * (0.7 + Math.random() * 0.6);
      p.maxLife      = p.life;
      p.vx           = Math.cos(angle) * radial;
      p.vy           = speed * (0.4 + Math.random() * 0.6);
      p.vz           = Math.sin(angle) * radial;
      p.mesh.position.set(px + (Math.random() - 0.5) * 0.2, py, pz + (Math.random() - 0.5) * 0.2);
      p.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      p.mesh.visible = true;
      p.active       = true;
    }
  }

  _acquire() {
    for (const p of this._pool) {
      if (!p.active) return p;
    }
    return null; // pool exhausted — silently drop
  }

  _getMesh(entityId) {
    if (entityId === 'player') return this._player?.mesh ?? null;
    return this._registry?.getEntityById(entityId)?.mesh ?? null;
  }

  _bindEvents() {
    const eb = this._eventBus;
    if (!eb) return;

    eb.on('enemy_damaged', ({ payload }) => {
      if (!this._enabled) return;
      const id  = payload?.enemyId;
      const pos = payload?.position ?? this._getMesh(id)?.position;
      if (id)  this.flashMesh(id);
      if (pos) this.spawnHit(pos);
      if (this._debug) console.log(`[HitFX] hit "${id}"`);
    });

    eb.on('enemy_killed', ({ payload }) => {
      if (!this._enabled) return;
      const id  = payload?.enemyId ?? payload?.id;
      const pos = payload?.position
        ?? (id ? this._getMesh(id)?.position : null)
        ?? { x: payload?.x ?? 0, y: 0.5, z: payload?.z ?? 0 };
      if (pos) this.spawnDeath(pos);
      if (this._debug) console.log(`[HitFX] death "${id}"`);
    });
  }

  _clearAll() {
    for (const p of this._pool) {
      p.active       = false;
      p.mesh.visible = false;
    }
    for (const f of this._flashing) {
      if (f.mesh?.material) f.mesh.material.color.setHex(f.origColor);
    }
    this._flashing = [];
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setEnabled(on = true) { this._enabled = on; }
  toggle()              { this._enabled = !this._enabled; console.log(`[HitFX] ${this._enabled ? 'ON' : 'OFF'}`); }
  setDebug(on = true)   { this._debug = on; }

  inspect() {
    const active = this._pool.filter(p => p.active).length;
    console.log(`[HitFX] particles: ${active}/${POOL_SIZE}, flashing: ${this._flashing.length}`);
  }

  /** Test effects at a world position: __debug.hitfx.test(0, 3) */
  test(x = 0, z = 0) {
    const pos = { x, y: 0.65, z };
    this.spawnHit(pos, 5, 0xff4400);
    this.spawnDeath(pos);
    console.log(`[HitFX] test burst at (${x}, ${z})`);
  }
}
