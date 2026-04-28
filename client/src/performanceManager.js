// Performance manager — FPS tracking, entity culling, and debug overlay.
//
// Does NOT throttle system updates directly — throttling lives in SystemManager.
// Instead provides shouldUpdate(entity, playerPos) for manual culling decisions
// and records per-system timing for the debug overlay.

export class PerformanceManager {
  constructor() {
    this._frameCount  = 0;
    this._fps         = 60;
    this._fpsTimer    = 0;
    this._timings     = {};    // label → ms (last sampled frame)
    this._starts      = {};    // label → performance.now() start
    this._cull        = { enabled: false, radiusSq: 40 * 40 };
    this._debugEl     = null;
    this._debugOn     = false;
    this.enabled      = true;
  }

  // ── Timing ────────────────────────────────────────────────────────────────

  // Call before a system's update block
  start(label) {
    if (!this.enabled) return;
    this._starts[label] = performance.now();
  }

  // Call after a system's update block
  end(label) {
    if (!this.enabled || this._starts[label] == null) return;
    this._timings[label] = performance.now() - this._starts[label];
    delete this._starts[label];
  }

  // ── FPS + main tick ───────────────────────────────────────────────────────

  // Call once per animate() frame
  tick(delta, entityCount = 0, eventQSize = 0) {
    if (!this.enabled) return;
    this._frameCount++;
    this._fpsTimer  += delta;

    if (this._fpsTimer >= 0.5) {
      this._fps        = Math.round(this._frameCount / this._fpsTimer);
      this._frameCount = 0;
      this._fpsTimer   = 0;
      if (this._debugOn) this._refreshDebug(entityCount, eventQSize);
    }
  }

  getFPS() { return this._fps; }

  // ── Entity culling ────────────────────────────────────────────────────────

  enableCull(radius = 40) {
    this._cull.enabled  = true;
    this._cull.radiusSq = radius * radius;
  }

  disableCull() { this._cull.enabled = false; }

  // Returns true if the entity should be updated this frame
  shouldUpdate(entity, playerPos) {
    if (!this._cull.enabled || !entity.mesh) return true;
    const dx = entity.mesh.position.x - playerPos.x;
    const dz = entity.mesh.position.z - playerPos.z;
    return dx * dx + dz * dz <= this._cull.radiusSq;
  }

  // ── Debug overlay ─────────────────────────────────────────────────────────

  toggleDebug() {
    this._debugOn = !this._debugOn;
    if (this._debugOn) {
      this._buildDebugEl();
    } else {
      this._debugEl?.remove();
      this._debugEl = null;
    }
    console.log(`[Perf] debug=${this._debugOn}`);
  }

  _buildDebugEl() {
    this._debugEl?.remove();
    const el = document.createElement('div');
    Object.assign(el.style, {
      position:    'fixed',
      top:         '42px',
      left:        '20px',
      background:  'rgba(0,0,0,0.78)',
      color:       '#0f0',
      fontSize:    '11px',
      padding:     '8px 12px',
      borderRadius:'4px',
      lineHeight:  '1.8',
      fontFamily:  'monospace',
      zIndex:      '400',
      pointerEvents:'none',
      minWidth:    '160px',
    });
    document.body.appendChild(el);
    this._debugEl = el;
  }

  _refreshDebug(entityCount, eventQSize) {
    if (!this._debugEl) return;
    const timingLines = Object.entries(this._timings)
      .map(([k, v]) => `${k}: ${v.toFixed(2)}ms`)
      .join('<br>');
    this._debugEl.innerHTML =
      `FPS: <b>${this._fps}</b><br>` +
      `Entities: ${entityCount}<br>` +
      `EventQ: ${eventQSize}<br>` +
      (timingLines ? `<br>${timingLines}` : '');
  }

  // ── Debug helpers ─────────────────────────────────────────────────────────

  inspect() {
    console.group('[Performance]');
    console.log(`FPS: ${this._fps}`);
    console.log(`Cull: ${this._cull.enabled ? `enabled (r=${Math.sqrt(this._cull.radiusSq).toFixed(0)})` : 'off'}`);
    for (const [k, v] of Object.entries(this._timings)) {
      console.log(`  ${k}: ${v.toFixed(2)}ms`);
    }
    console.groupEnd();
  }
}
