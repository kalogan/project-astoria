// Dynamic world state manager.
// Tracks per-zone states (normal / cleared / invaded) and time-based respawn.
//
// Integrates as a systemManager system — init() per zone load, update() per frame.
// Subscribes to enemy_killed internally; emits zone_state_changed via eventBus.

const STATES          = Object.freeze(['normal', 'cleared', 'invaded']);
const RESPAWN_DELAY   = 120; // game-seconds before a cleared zone resets

export class WorldStateManager {
  constructor() {
    this._zones      = new Map(); // zoneId → ZoneEntry
    this._activeZone = null;
    this._eventBus   = null;
    this._unsub      = null;
  }

  // ── SystemManager interface ───────────────────────────────────────────────

  init(zone, registry, eventBus) {
    this._eventBus   = eventBus;
    this._activeZone = zone.id;

    // Replace per-zone enemy_killed subscription
    this._unsub?.();
    this._unsub = eventBus.on('enemy_killed', () => this._onEnemyKilled());

    const enemies  = registry.getEntitiesByType('enemy');
    const total    = enemies.length;
    const alive    = enemies.filter(e => e.alive).length;
    const killed   = total - alive;

    if (!this._zones.has(zone.id)) {
      const initState = (total > 0 && alive === 0) ? 'cleared' : 'normal';
      this._zones.set(zone.id, {
        state:            initState,
        killCount:        killed,
        totalEnemies:     total,
        timeSinceCleared: 0,
        modifiers:        [],
      });
    } else {
      const entry = this._zones.get(zone.id);
      entry.totalEnemies = total;
      entry.killCount    = killed;
      if (total > 0 && alive === 0 && entry.state === 'normal') {
        entry.state = 'cleared'; // silent — zone was already cleared before
      }
    }
  }

  update(delta) {
    for (const [zoneId, entry] of this._zones) {
      if (entry.state !== 'cleared')      continue;
      if (zoneId === this._activeZone)    continue; // never respawn while player is there
      entry.timeSinceCleared += delta;
      if (entry.timeSinceCleared >= RESPAWN_DELAY) {
        entry.state            = 'normal';
        entry.killCount        = 0;
        entry.timeSinceCleared = 0;
        this._eventBus?.emit('zone_state_changed', {
          zoneId, state: 'normal', prevState: 'cleared',
        });
        console.log(`[WorldState] "${zoneId}" respawned`);
      }
    }
  }

  onEvent(_event) {}

  // ── State access ──────────────────────────────────────────────────────────

  getState(zoneId)      { return this._zones.get(zoneId) ?? null; }
  getActiveState()      { return this._activeZone ? this._zones.get(this._activeZone) ?? null : null; }

  setState(zoneId, state) {
    if (!STATES.includes(state)) {
      console.warn(`[WorldState] Unknown state "${state}". Valid: ${STATES.join(', ')}`);
      return;
    }
    this._setStateSilent(zoneId, state, true);
  }

  // ── Modifiers ─────────────────────────────────────────────────────────────

  addModifier(zoneId, modifier) {
    const entry = this._getOrCreate(zoneId);
    if (!entry.modifiers.includes(modifier)) {
      entry.modifiers.push(modifier);
      this._eventBus?.emit('zone_modifier_added', { zoneId, modifier });
    }
  }

  removeModifier(zoneId, modifier) {
    const entry = this._zones.get(zoneId);
    if (!entry) return;
    const i = entry.modifiers.indexOf(modifier);
    if (i !== -1) entry.modifiers.splice(i, 1);
  }

  hasModifier(zoneId, modifier) {
    return this._zones.get(zoneId)?.modifiers.includes(modifier) ?? false;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save() {
    const zones = {};
    for (const [id, entry] of this._zones) {
      zones[id] = {
        state:            entry.state,
        killCount:        entry.killCount,
        totalEnemies:     entry.totalEnemies,
        timeSinceCleared: entry.timeSinceCleared,
        modifiers:        entry.modifiers.slice(),
      };
    }
    return { zones };
  }

  load(data) {
    if (!data?.zones) return;
    for (const [id, s] of Object.entries(data.zones)) {
      this._zones.set(id, {
        state:            s.state            ?? 'normal',
        killCount:        s.killCount        ?? 0,
        totalEnemies:     s.totalEnemies     ?? 0,
        timeSinceCleared: s.timeSinceCleared ?? 0,
        modifiers:        s.modifiers        ?? [],
      });
    }
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.group('[WorldState] All zones');
    for (const [id, e] of this._zones) {
      console.log(
        `  ${id.padEnd(35)} state=${e.state.padEnd(8)} ` +
        `kills=${String(e.killCount).padStart(3)}/${String(e.totalEnemies).padStart(3)} ` +
        (e.modifiers.length ? `mods=[${e.modifiers.join(',')}]` : ''),
      );
    }
    console.groupEnd();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _onEnemyKilled() {
    if (!this._activeZone) return;
    const entry = this._zones.get(this._activeZone);
    if (!entry) return;
    entry.killCount++;
    if (entry.killCount >= entry.totalEnemies && entry.totalEnemies > 0) {
      this._setStateSilent(this._activeZone, 'cleared', true);
    }
  }

  _setStateSilent(zoneId, state, emit = false) {
    const entry = this._getOrCreate(zoneId);
    if (entry.state === state) return;
    const prev = entry.state;
    entry.state = state;
    if (state === 'cleared') entry.timeSinceCleared = 0;
    if (emit) {
      this._eventBus?.emit('zone_state_changed', { zoneId, state, prevState: prev });
    }
    console.log(`[WorldState] "${zoneId}": ${prev} → ${state}`);
  }

  _getOrCreate(zoneId) {
    if (!this._zones.has(zoneId)) {
      this._zones.set(zoneId, { state: 'normal', killCount: 0, totalEnemies: 0, timeSinceCleared: 0, modifiers: [] });
    }
    return this._zones.get(zoneId);
  }
}
