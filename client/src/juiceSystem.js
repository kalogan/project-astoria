// Juice system — visual polish and game-feel enhancements.
//
// Subscribes to gameplay events via eventBus and triggers:
//   - camera shake (exposes shakeOffset, added to camera.position in main.js)
//   - death particle bursts (Three.js BoxGeometry shards)
//   - screen flash overlays (DOM, CSS transition)
//
// All effects are lightweight: no heavy particle systems, no external libs.
// Intensity can be scaled (0 = off, 1 = normal, 2 = extra).

import * as THREE from 'three';

// ── Shake presets ─────────────────────────────────────────────────────────────

const SHAKE = {
  heavy:  { magnitude: 0.32, duration: 0.26 },
  medium: { magnitude: 0.16, duration: 0.18 },
  light:  { magnitude: 0.07, duration: 0.10 },
};

const PARTICLE_COUNT = 6;
const PARTICLE_LIFE  = 0.42;

// ── JuiceSystem ───────────────────────────────────────────────────────────────

export class JuiceSystem {
  constructor(scene, camera) {
    this._scene      = scene;
    this._camera     = camera;
    this._shake      = null;
    this.shakeOffset = new THREE.Vector3();
    this._particles  = [];
    this._eventBus   = null;
    this.enabled     = true;
    this.intensity   = 1.0;  // 0 = off, 1 = normal, 2 = strong
  }

  // Subscribe once — survives zone reloads
  subscribe(eventBus) {
    this._eventBus = eventBus;

    eventBus.on('player_damaged', ({ payload }) => {
      if (!this.enabled) return;
      const heavy = (payload.damage ?? 0) > 15;
      this._triggerShake(heavy ? SHAKE.heavy : SHAKE.medium);
      this._screenFlash('#c0392b', heavy ? 0.35 : 0.22);
    });

    eventBus.on('enemy_killed', ({ payload }) => {
      if (!this.enabled) return;
      this._spawnParticles(payload.x ?? 0, payload.z ?? 0, 0xff4400);
      this._triggerShake(SHAKE.light);
    });

    eventBus.on('enemy_damaged', ({ payload }) => {
      if (!this.enabled || !payload.crit) return;
      this._triggerShake(SHAKE.medium);
    });

    eventBus.on('ability_used', () => {
      if (!this.enabled) return;
      this._triggerShake(SHAKE.light);
    });

    eventBus.on('level_up', () => {
      if (!this.enabled) return;
      this._screenFlash('#2980b9', 0.22);
    });

    eventBus.on('dungeon_completed', () => {
      if (!this.enabled) return;
      this._screenFlash('#f39c12', 0.28);
    });

    eventBus.on('dungeon_started', () => {
      if (!this.enabled) return;
      this._screenFlash('#2c3e50', 0.5);
    });
  }

  // ── Update (called every frame by systemManager) ──────────────────────────

  update(delta) {
    this._updateShake(delta);
    this._updateParticles(delta);
  }

  onEvent() {}
  init()    {}

  // ── Camera shake ──────────────────────────────────────────────────────────

  _updateShake(delta) {
    if (!this._shake) return;
    this._shake.timer -= delta;
    if (this._shake.timer <= 0) {
      this._shake = null;
      this.shakeOffset.set(0, 0, 0);
      return;
    }
    const t   = this._shake.timer / this._shake.duration;
    const mag = this._shake.magnitude * t * this.intensity;
    this.shakeOffset.set(
      (Math.random() - 0.5) * 2 * mag,
      0,
      (Math.random() - 0.5) * 2 * mag,
    );
  }

  _triggerShake(preset) {
    const current = this._shake;
    if (!current || preset.magnitude > current.magnitude) {
      this._shake = {
        magnitude: preset.magnitude * this.intensity,
        duration:  preset.duration,
        timer:     preset.duration,
      };
    }
  }

  // ── Particle bursts ───────────────────────────────────────────────────────

  _spawnParticles(x, z, color) {
    if (!this._scene) return;

    const geo    = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const meshes = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);

      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const spd   = 2.0 + Math.random() * 2.5;
      mesh.userData.vx = Math.cos(angle) * spd;
      mesh.userData.vz = Math.sin(angle) * spd;
      mesh.userData.vy = 1.5 + Math.random() * 1.8;

      mesh.position.set(x, 0.5, z);
      this._scene.add(mesh);
      meshes.push(mesh);
    }

    this._particles.push({ meshes, life: PARTICLE_LIFE });
  }

  _updateParticles(delta) {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= delta;

      if (p.life <= 0) {
        for (const m of p.meshes) this._scene?.remove(m);
        this._particles.splice(i, 1);
        continue;
      }

      const t = p.life / PARTICLE_LIFE;
      for (const m of p.meshes) {
        m.position.x         += m.userData.vx * delta;
        m.position.z         += m.userData.vz * delta;
        m.position.y         += m.userData.vy * delta;
        m.userData.vy        -= delta * 5;          // gravity
        m.material.opacity    = t;
        m.scale.setScalar(t * 0.9 + 0.1);
      }
    }
  }

  // ── Screen flash ──────────────────────────────────────────────────────────

  _screenFlash(color, alpha) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:      'fixed',
      top:           '0', left: '0',
      width:         '100vw', height: '100vh',
      background:    color,
      opacity:       String(Math.min(1, alpha * this.intensity)),
      pointerEvents: 'none',
      transition:    'opacity 0.32s ease-out',
      zIndex:        '301',
    });
    document.body.appendChild(overlay);
    overlay.getBoundingClientRect(); // force reflow
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 380);
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  setIntensity(v) {
    this.intensity = Math.max(0, Math.min(2, v));
    if (this.intensity === 0) {
      this.enabled = false;
      this._shake = null;
      this.shakeOffset.set(0, 0, 0);
    } else {
      this.enabled = true;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) { this._shake = null; this.shakeOffset.set(0, 0, 0); }
    console.log(`[Juice] enabled=${this.enabled}`);
  }

  inspect() {
    console.log(`[Juice] enabled=${this.enabled}  intensity=${this.intensity.toFixed(1)}  particles=${this._particles.length}  shake=${this._shake ? `${this._shake.timer.toFixed(2)}s` : 'none'}`);
  }
}
