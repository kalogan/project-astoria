// saveSystem.js — multi-slot save system.
//
// Storage layout (localStorage):
//   astoria_saves_v4_index          → JSON array of SaveMeta objects (lightweight)
//   astoria_save_v4_<id>            → JSON full save data for one slot
//
// ── SaveMeta (stored in index, used for UI) ───────────────────────────────────
//   id          string    unique save identifier  's_1714000000000_ab3f'
//   name        string    display name            'Mage'
//   class       string    class key               'mage' | 'warrior' | 'rogue'
//   level       number    player level            5
//   clan        string?   clan name or null
//   zoneId      string    last zone               'Cameron'
//   lastPlayed  string    ISO date string
//   portrait    string    data-URL from canvas    'data:image/png;base64,...'
//   playtime    number    seconds played
//
// ── Active save ───────────────────────────────────────────────────────────────
//   Call setActiveSaveId(id) immediately when a game session begins (new or load).
//   All subsequent saveGame() calls without an explicit saveId use this value.
//
// ── Backward compat ───────────────────────────────────────────────────────────
//   On first access, any legacy 'astoria_save' (v3) is imported as a new slot.

const INDEX_KEY   = 'astoria_saves_v4_index';
const SAVE_PREFIX = 'astoria_save_v4_';
const VERSION     = 4;
const MAX_SAVES   = 5;

// Currently active save slot for this session
let _activeSaveId = null;

// ── Public: active save tracking ──────────────────────────────────────────────

export function getActiveSaveId()    { return _activeSaveId; }
export function setActiveSaveId(id)  { _activeSaveId = id; }

/** Generate a unique save ID. */
export function newSaveId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Public: index ─────────────────────────────────────────────────────────────

/** Return the metadata array (never null). Sorted newest-first. */
export function loadIndex() {
  _migrateLegacyOnce();
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return arr.sort((a, b) => (b.lastPlayed ?? '') < (a.lastPlayed ?? '') ? -1 : 1);
  } catch { return []; }
}

/** True if at least one save exists. */
export function hasSaves() {
  return loadIndex().length > 0;
}

// ── Public: load ──────────────────────────────────────────────────────────────

/**
 * Load and return full save data for a specific slot (version-gated).
 * Also sets that slot as the active save for this session.
 * Returns null if id is missing or data is incompatible.
 */
export function loadGame(saveId) {
  const id = saveId ?? _activeSaveId;
  if (!id) return null;
  try {
    const raw  = localStorage.getItem(SAVE_PREFIX + id);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== VERSION) return null;
    _activeSaveId = id;
    return data;
  } catch { return null; }
}

/** Load a single zone's saved state. */
export function loadZoneState(zoneId) {
  return loadGame(_activeSaveId)?.zones?.[zoneId] ?? null;
}

// ── Public: save ──────────────────────────────────────────────────────────────

/**
 * Full save: player + zone snapshot + quests + progression + build + etc.
 * Automatically regenerates portrait and updates index metadata.
 */
export function saveGame({ saveId, player, zone, combat, questSys, inventory,
                           progression, worldState, build, skillTree }) {
  const id = saveId ?? _activeSaveId;
  if (!id) { console.warn('[Save] No active save ID — call setActiveSaveId() first'); return; }

  // Load or create the state blob for this slot
  const state = _loadRaw(id) ?? _blank(id);

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

  // Track playtime
  const now = Date.now();
  const prev = state._savedAt ?? now;
  state._playtime = (state._playtime ?? 0) + Math.round((now - prev) / 1000);
  state._savedAt  = now;

  _writeRaw(id, state);
  _activeSaveId = id;

  // Update index metadata (portrait regenerated on every save)
  _updateIndex({
    id,
    name:       _className(build?.getClass?.()),
    class:      build?.getClass?.() ?? 'warrior',
    level:      progression?.getLevel?.() ?? player.level ?? 1,
    clan:       null,   // TODO: wire clanManager when available
    zoneId:     zone.activeId ?? '—',
    lastPlayed: new Date().toISOString(),
    portrait:   generatePortrait(build?.getClass?.()),
    playtime:   state._playtime,
  });
}

/** Snapshot a single zone without touching player / progression. */
export function saveZoneState(zoneId, snapshot) {
  const id = _activeSaveId;
  if (!id) return;
  const state = _loadRaw(id);
  if (!state) return;
  state.zones[zoneId] = snapshot;
  _writeRaw(id, state);
}

export function clearZoneState(zoneId) {
  const id = _activeSaveId;
  if (!id) return;
  const state = _loadRaw(id);
  if (!state?.zones?.[zoneId]) return;
  delete state.zones[zoneId];
  _writeRaw(id, state);
}

// ── Public: delete ────────────────────────────────────────────────────────────

export function deleteSave(saveId) {
  localStorage.removeItem(SAVE_PREFIX + saveId);
  _removeFromIndex(saveId);
  if (_activeSaveId === saveId) _activeSaveId = null;
}

// ── Portrait generation ───────────────────────────────────────────────────────

/**
 * Render a 64×64 class portrait to a canvas and return its data-URL.
 * Called during saveGame() so portraits stay fresh.
 */
export function generatePortrait(className) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    _drawPortrait(ctx, (className ?? 'warrior').toLowerCase());
    return canvas.toDataURL('image/png');
  } catch { return ''; }
}

// ── Private: portrait drawing ─────────────────────────────────────────────────

function _drawPortrait(ctx, cls) {
  const W = 64, H = 64;

  const BG = { mage: ['#0d0921','#201470'], warrior: ['#0d1019','#1b2535'], rogue: ['#080808','#1a130a'] };
  const [bg1, bg2] = BG[cls] ?? BG.warrior;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, bg1);
  grad.addColorStop(1, bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (cls === 'mage') {
    // Robe (trapezoid): wide bottom, narrow top
    ctx.fillStyle = '#201470';
    ctx.beginPath();
    ctx.moveTo(16, 62); ctx.lineTo(48, 62);
    ctx.lineTo(38, 36); ctx.lineTo(26, 36);
    ctx.closePath();
    ctx.fill();
    // Gold belt
    ctx.fillStyle = '#b08820';
    ctx.fillRect(25, 35, 14, 4);
    // Head
    ctx.fillStyle = '#e2bc90';
    ctx.beginPath();
    ctx.arc(32, 27, 8, 0, Math.PI * 2);
    ctx.fill();
    // Hat brim
    ctx.fillStyle = '#160c4a';
    ctx.beginPath();
    ctx.ellipse(32, 20, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hat cone
    ctx.fillStyle = '#201470';
    ctx.beginPath();
    ctx.moveTo(21, 20); ctx.lineTo(32, 3); ctx.lineTo(43, 20);
    ctx.closePath();
    ctx.fill();
    // Staff (right side)
    ctx.strokeStyle = '#6b4a1e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 8); ctx.lineTo(50, 60);
    ctx.stroke();
    // Orb (glowing)
    ctx.fillStyle = '#38c8ff';
    ctx.shadowColor = '#38c8ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(50, 8, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

  } else if (cls === 'warrior') {
    // Boots
    ctx.fillStyle = '#383030';
    ctx.fillRect(20, 52, 10, 10); ctx.fillRect(34, 52, 10, 10);
    // Legs (chain)
    ctx.fillStyle = '#586070';
    ctx.fillRect(21, 38, 22, 16);
    // Torso (plate)
    ctx.fillStyle = '#708090';
    ctx.fillRect(16, 20, 32, 20);
    // Pauldrons
    ctx.fillStyle = '#8898a8';
    ctx.fillRect(10, 20, 8, 10); ctx.fillRect(46, 20, 8, 10);
    // Neck
    ctx.fillStyle = '#e2bc90';
    ctx.fillRect(27, 14, 10, 7);
    // Helmet
    ctx.fillStyle = '#607888';
    ctx.fillRect(20, 5, 24, 18);
    // Helmet crest
    ctx.fillStyle = '#8898a8';
    ctx.fillRect(30, 2, 4, 6);
    // Sword (right of body)
    ctx.fillStyle = '#c8d8e8';
    ctx.fillRect(52, 8, 4, 36);
    ctx.fillStyle = '#8b7040';
    ctx.fillRect(48, 24, 12, 3);

  } else if (cls === 'rogue') {
    // Lower body
    ctx.fillStyle = '#1e1c18';
    ctx.beginPath();
    ctx.moveTo(20, 62); ctx.lineTo(44, 62);
    ctx.lineTo(38, 36); ctx.lineTo(26, 36);
    ctx.closePath();
    ctx.fill();
    // Torso
    ctx.fillStyle = '#352c1c';
    ctx.fillRect(24, 24, 16, 14);
    // Head
    ctx.fillStyle = '#e2bc90';
    ctx.beginPath();
    ctx.arc(32, 19, 8, 0, Math.PI * 2);
    ctx.fill();
    // Hood (large dark circle over head)
    ctx.fillStyle = '#221e14';
    ctx.beginPath();
    ctx.arc(32, 18, 10, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(32, 18, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Twin daggers (crossed)
    ctx.strokeStyle = '#a8b8c0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(22, 30); ctx.lineTo(32, 42);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(42, 30); ctx.lineTo(32, 42);
    ctx.stroke();

  } else {
    // Generic enemy silhouette
    ctx.fillStyle = '#4a2010';
    ctx.fillRect(20, 32, 24, 28);
    ctx.fillRect(22, 16, 20, 18);
    ctx.fillStyle = '#6b3018';
    ctx.fillRect(24, 8, 16, 12);
  }

  // Subtle vignette border
  const vign = ctx.createRadialGradient(W/2, H/2, W*0.3, W/2, H/2, W*0.7);
  vign.addColorStop(0, 'transparent');
  vign.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, W, H);
}

// ── Private: storage ──────────────────────────────────────────────────────────

function _blank(id) {
  return { version: VERSION, id, player: null, zones: {}, quests: [],
           progression: null, worldState: null, build: null, skillTree: null,
           _playtime: 0, _savedAt: Date.now() };
}

function _loadRaw(id) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + id);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d.version === VERSION ? d : null;
  } catch { return null; }
}

function _writeRaw(id, state) {
  try { localStorage.setItem(SAVE_PREFIX + id, JSON.stringify(state)); }
  catch (err) { console.warn('[Save] write failed:', err); }
}

function _updateIndex(meta) {
  const index = loadIndex();
  const i     = index.findIndex(m => m.id === meta.id);
  if (i >= 0) index[i] = meta;
  else        index.unshift(meta);
  // Cap at MAX_SAVES
  _writeIndex(index.slice(0, MAX_SAVES));
}

function _removeFromIndex(id) {
  _writeIndex(loadIndex().filter(m => m.id !== id));
}

function _writeIndex(arr) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(arr)); }
  catch (err) { console.warn('[Save] index write failed:', err); }
}

// ── Private: legacy migration ─────────────────────────────────────────────────

let _migrated = false;
function _migrateLegacyOnce() {
  if (_migrated) return;
  _migrated = true;
  try {
    const raw = localStorage.getItem('astoria_save');
    if (!raw) return;
    const old = JSON.parse(raw);
    if (!old?.player) return;
    // Check not already migrated
    const existing = localStorage.getItem(INDEX_KEY);
    if (existing) return;

    const id    = newSaveId();
    const state = { ...old, version: VERSION, id, _playtime: 0, _savedAt: Date.now() };
    _writeRaw(id, state);
    _updateIndex({
      id,
      name:       _className(old.build?.className),
      class:      old.build?.className ?? 'warrior',
      level:      old.progression?.level ?? 1,
      clan:       null,
      zoneId:     old.player?.zoneId ?? '—',
      lastPlayed: new Date().toISOString(),
      portrait:   generatePortrait(old.build?.className),
      playtime:   0,
    });
    // Keep old key so page reload still works until user explicitly loads new slot
  } catch (err) {
    console.warn('[Save] legacy migration failed:', err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _className(cls) {
  return cls ? cls.charAt(0).toUpperCase() + cls.slice(1) : 'Warrior';
}

function _captureZone(zone, combat) {
  const reg = zone.registry;
  return {
    doors:    reg.getEntitiesByType('door').map(d => ({ id: d.id, locked: d.locked })),
    enemies:  reg.getEntitiesByType('enemy').map(e => ({
      id: e.id, x: e.mesh.position.x, z: e.mesh.position.z,
      hp: e.hp, alive: e.alive,
    })),
    triggers: zone.triggers?.triggers.map(t => ({ fired: t.fired })) ?? [],
    loot:     combat.loot.map(l => ({
      x: l.mesh.position.x, z: l.mesh.position.z, collected: l.collected,
    })),
  };
}
