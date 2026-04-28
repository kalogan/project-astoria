// spawnerSystem.js — continuous enemy respawn system.
// Reads zone.spawnPoints (top-level array on zone object) via init().
// Each spawn point: { id, x, z, interval, maxActive, enemyType, hp, speed, attackDamage, color, xpValue }
// Tracks active enemy count per spawn point.
// Uses seeded RNG for spawn timing jitter.

import { Enemy } from './enemySystem.js';

export class SpawnerSystem {
  constructor() {
    this._points   = [];  // SpawnPointState[]
    this._scene    = null;
    this._registry = null;
    this._eventBus = null;
    this._grid     = null;
    this.enabled   = true;
  }

  setContext({ scene }) { this._scene = scene; }

  init(zone, registry, eventBus, rng) {
    this._registry = registry;
    this._eventBus = eventBus;
    this._rng      = rng;
    // zone here is { id, grid, gridOffset } from systemMgr.initZone call
    this._grid = zone.grid ?? null;

    // Load spawn point defs from zone metadata
    // Main.js must attach spawnPoints from the full zone object after initZone
    this._points = [];
  }

  // Called from main.js after init to load the actual spawn point defs
  loadSpawnPoints(defs) {
    this._points = defs.map(d => ({
      def:    d,
      timer:  d.interval * 0.5,  // stagger initial spawn
      active: new Set(),          // Set of enemy ids currently alive from this point
    }));
  }

  update(delta) {
    if (!this.enabled || !this._grid) return;
    for (const pt of this._points) {
      // Count still-alive enemies from this point
      pt.active = new Set(
        [...pt.active].filter(id => {
          const e = this._registry?.getEntityById(id);
          return e?.alive;
        })
      );

      if (pt.active.size >= pt.def.maxActive) continue;

      pt.timer -= delta;
      if (pt.timer > 0) continue;

      // Jitter: reset timer with ±20% variation using rng
      const jitter = this._rng ? this._rng.nextFloat(0.8, 1.2) : 1;
      pt.timer = pt.def.interval * jitter;

      this._spawn(pt);
    }
  }

  _spawn(pt) {
    if (!this._scene) return;
    const d   = pt.def;
    const id  = `spawn_${d.id}_${Date.now() & 0xFFFF}`;
    const def = {
      id,
      type:         d.enemyType,
      x:            d.x + (this._rng ? this._rng.nextFloat(-0.5, 0.5) : 0),
      z:            d.z + (this._rng ? this._rng.nextFloat(-0.5, 0.5) : 0),
      hp:           d.hp,
      speed:        d.speed,
      attackDamage: d.attackDamage,
      color:        d.color,
      xpValue:      d.xpValue,
    };
    const enemy = new Enemy(this._scene, this._grid, def);
    this._registry?.register('enemy', enemy);
    pt.active.add(id);
  }

  onEvent() {}

  toggle() {
    this.enabled = !this.enabled;
    console.log(`[Spawner] enabled=${this.enabled}`);
  }

  inspect() {
    for (const pt of this._points) {
      console.log(`[Spawner] ${pt.def.id}: active=${pt.active.size}/${pt.def.maxActive} timer=${pt.timer.toFixed(1)}s`);
    }
  }
}
