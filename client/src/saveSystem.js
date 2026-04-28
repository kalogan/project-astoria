const KEY     = 'astoria_save';
const VERSION = 3;  // bumped: added progression + worldState fields

// ── Public API ────────────────────────────────────────────────

export function hasSave() {
  return !!_load();
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

// Returns the full save object or null (version-gated)
export function loadGame() {
  return _load();
}

// Returns a single zone's saved state or null if never visited
export function loadZoneState(zoneId) {
  return _load()?.zones?.[zoneId] ?? null;
}

// Full save: player + zone snapshot + quests + progression + world state + build + skill tree
export function saveGame({ player, zone, combat, questSys, inventory, progression, worldState, build, skillTree }) {
  const state = _load() ?? _blank();

  state.player = {
    x:         player.mesh.position.x,
    y:         player.mesh.position.y,
    z:         player.mesh.position.z,
    hp:        player.hp,
    zoneId:    zone.activeId,
    inventory: inventory.items.slice(),
  };

  if (zone.activeId) {
    state.zones[zone.activeId] = _captureZone(zone, combat);
  }

  state.quests = questSys.all().map(q => ({
    id: q.id, type: q.type, title: q.title, goal: q.goal,
    progress: q.progress, complete: q.complete,
  }));

  if (progression) state.progression = progression.save();
  if (worldState)  state.worldState  = worldState.save();
  if (build)       state.build       = build.save();
  if (skillTree)   state.skillTree   = skillTree.save();

  _write(state);
}

// Snapshot a single zone without touching player, quests, or progression
export function saveZoneState(zoneId, snapshot) {
  const state = _load();
  if (!state) return;
  state.zones[zoneId] = snapshot;
  _write(state);
}

// Remove a zone's saved state (used by debug regen to start fresh)
export function clearZoneState(zoneId) {
  const state = _load();
  if (!state?.zones?.[zoneId]) return;
  delete state.zones[zoneId];
  _write(state);
}

// ── Private ───────────────────────────────────────────────────

function _blank() {
  return { version: VERSION, player: null, zones: {}, quests: [], progression: null, worldState: null, build: null, skillTree: null };
}

function _captureZone(zone, combat) {
  const reg = zone.registry;
  return {
    doors: reg.getEntitiesByType('door').map(d => ({
      id: d.id, locked: d.locked,
    })),
    enemies: reg.getEntitiesByType('enemy').map(e => ({
      id: e.id,
      x: e.mesh.position.x, z: e.mesh.position.z,
      hp: e.hp, alive: e.alive,
    })),
    triggers: zone.triggers?.triggers.map(t => ({ fired: t.fired })) ?? [],
    loot: combat.loot.map(l => ({
      x: l.mesh.position.x, z: l.mesh.position.z, collected: l.collected,
    })),
  };
}

function _load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.version === VERSION ? data : null;
  } catch { return null; }
}

function _write(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (err) { console.warn('[Save] write failed:', err); }
}
