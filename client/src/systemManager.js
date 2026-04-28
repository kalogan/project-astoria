// System manager — owns zone-scoped systems and drives their update loop.
//
// Per-system throttle intervals (ms):
//   AI / pathfinding — 200ms (configured at registration)
//   UI systems       — 0 (every frame, default)
//
// Throttled systems still receive the real delta on each call so that
// accumulated time is correctly accounted for inside the system.

export const THROTTLE = {
  ai:          200,
  pathfinding: 300,
  ui:          0,
};

export class SystemManager {
  constructor() {
    this._entries     = [];   // { sys, throttleMs, elapsed }
    this._lastZone     = null;
    this._lastRegistry = null;
    this._lastEventBus = null;
    this._lastRng      = null;
  }

  // Register a single system with an optional minimum update interval (ms).
  // throttleMs=0 (default) means update every frame.
  register(system, throttleMs = 0) {
    const entry = { sys: system, throttleMs, elapsed: 0 };
    this._entries.push(entry);
    if (this._lastRegistry !== null) {
      system.init?.(this._lastZone, this._lastRegistry, this._lastEventBus, this._lastRng);
    }
    return this;
  }

  // Replace all zone-scoped systems at once (called on every zone load).
  // Systems are registered with throttleMs=0 unless passed as { sys, throttleMs }.
  replaceAll(...systems) {
    this._entries = systems
      .filter(Boolean)
      .map(s => typeof s === 'object' && 'sys' in s
        ? { sys: s.sys, throttleMs: s.throttleMs ?? 0, elapsed: 0 }
        : { sys: s,     throttleMs: 0,                 elapsed: 0 },
      );
    return this;
  }

  // Call init(zone, registry, eventBus, rng) on every registered system.
  initZone(zone, registry, eventBus, rng = null) {
    this._lastZone     = zone;
    this._lastRegistry = registry;
    this._lastEventBus = eventBus;
    this._lastRng      = rng;
    for (const { sys } of this._entries) sys.init?.(zone, registry, eventBus, rng);
  }

  // delta is in seconds
  update(delta) {
    const deltaMs = delta * 1000;
    for (const entry of this._entries) {
      if (entry.throttleMs > 0) {
        entry.elapsed += deltaMs;
        if (entry.elapsed < entry.throttleMs) continue;
        entry.elapsed = 0;
      }
      entry.sys.update?.(delta);
    }
  }

  onEvent(event) {
    for (const { sys } of this._entries) sys.onEvent?.(event);
  }
}
