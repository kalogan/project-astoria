// Deterministic game clock — accumulates delta, never calls Date.now().
// Drives EventBus timestamps so events are replayable and server-authoritative.

export class GameClock {
  constructor() {
    this._elapsed = 0; // seconds since first tick
    this._ticks   = 0; // frame count
  }

  tick(delta) {
    this._elapsed += delta;
    this._ticks++;
  }

  // Seconds since simulation start (deterministic, not wall-clock)
  getTime()  { return this._elapsed; }
  getTicks() { return this._ticks; }

  reset() { this._elapsed = 0; this._ticks = 0; }
}
