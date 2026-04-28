// questGen.js — quest and encounter placement for generated dungeons.
//
// Reads zone._rooms (produced by dungeonGen.js) and:
//   1. Places enemy/NPC entities inside each room based on room type.
//   2. Scales encounter difficulty by distance from start room.
//   3. Attaches a quest object to zone.quest.
//   4. Returns a new zone object (original is not mutated).
//
// Room types → encounter templates:
//   start    → empty (safe zone)
//   normal   → 1–3 slimes or skeletons, scaled by distance
//   elite    → 2–4 skeletons + 1 slime, higher level
//   treasure → no enemies (visual marker only for now)
//   boss     → 1 skeleton at max level

import { mulberry32, deepClone } from './constants';

// ── Entity builders ───────────────────────────────────────────────────────────

function _uid(prefix, salt) {
  return `${prefix}_${salt}_${Math.floor(Math.random() * 1e6)}`;
}

// Convert grid (row, col) to world position, matching gridToWorld in isoUtils.
// Formula: world.x = col - cols/2, world.z = row - rows/2
function _worldPos(row, col, rows, cols) {
  return { x: col - cols / 2, y: 0, z: row - rows / 2 };
}

// Place entities randomly inside a room rectangle, avoiding duplicates.
function _scatter(room, count, rows, cols, rng, entities, buildFn) {
  const placed = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      // Random tile inside room (inset by 1 to avoid edges)
      const r = room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2));
      const c = room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2));
      const key = `${r},${c}`;
      if (placed.includes(key)) continue;
      placed.push(key);
      entities.push(buildFn(r, c, rows, cols, i));
      break;
    }
  }
}

function _enemy(subtype, level, r, c, rows, cols, salt) {
  return {
    id:       _uid('enemy', `${r}${c}${salt}`),
    type:     'enemy',
    subtype,
    position: _worldPos(r, c, rows, cols),
    facing:   'south',
    config:   { level: String(level) },
  };
}

// ── Encounter templates ───────────────────────────────────────────────────────

const TEMPLATES = {
  start: () => [],

  normal: (room, dist, maxDist, rows, cols, rng, salt) => {
    const entities = [];
    const count    = 1 + Math.round(rng() * 2);               // 1–3
    const level    = Math.max(1, Math.round(1 + dist * 1.5)); // scales with depth
    const subtype  = rng() < 0.6 ? 'slime' : 'skeleton';
    _scatter(room, count, rows, cols, rng, entities, (r, c, rs, cs, i) =>
      _enemy(subtype, level, r, c, rs, cs, `${salt}n${i}`));
    return entities;
  },

  elite: (room, dist, maxDist, rows, cols, rng, salt) => {
    const entities = [];
    const level    = Math.max(2, Math.round(2 + dist * 2));
    _scatter(room, 3, rows, cols, rng, entities, (r, c, rs, cs, i) =>
      _enemy('skeleton', level, r, c, rs, cs, `${salt}e${i}`));
    _scatter(room, 1, rows, cols, rng, entities, (r, c, rs, cs, i) =>
      _enemy('slime', Math.max(1, level - 1), r, c, rs, cs, `${salt}es${i}`));
    return entities;
  },

  treasure: (room, dist, maxDist, rows, cols, rng, salt) => {
    // No enemies — room is safe; questGen marks it visually via zone._rooms
    return [];
  },

  boss: (room, dist, maxDist, rows, cols, rng, salt) => {
    const entities = [];
    const level    = Math.max(5, Math.round(3 + dist * 2));
    // Boss: one high-level skeleton at room centre
    const r = Math.round(room.cy), c = Math.round(room.cx);
    entities.push(_enemy('skeleton', level, r, c, rows, cols, `${salt}boss`));
    // Two guards
    _scatter(room, 2, rows, cols, rng, entities, (gr, gc, rs, cs, i) =>
      _enemy('slime', Math.max(1, level - 2), gr, gc, rs, cs, `${salt}bg${i}`));
    return entities;
  },
};

// ── Quest structure ───────────────────────────────────────────────────────────

function buildQuest(typedRooms) {
  const bossRoom = typedRooms.find(r => r.roomType === 'boss');
  const objectives = [];

  objectives.push({
    id:          'obj_explore',
    type:        'rooms_visited',
    description: `Explore ${typedRooms.length} rooms`,
    count:       typedRooms.length,
    completed:   false,
  });

  if (bossRoom) {
    objectives.push({
      id:          'obj_boss',
      type:        'kill_boss',
      description: 'Defeat the dungeon boss',
      roomId:      bossRoom.id,
      count:       1,
      completed:   false,
    });
  }

  return {
    id:          'quest_dungeon_clear',
    title:       'Clear the Dungeon',
    description: 'Explore the dungeon, defeat all enemies, and slay the boss.',
    objectives,
    rewards:     { exp: 500 + typedRooms.length * 100, gold: 200 + typedRooms.length * 50 },
    active:      true,
    completed:   false,
  };
}

// ── Room type visual markers ──────────────────────────────────────────────────
// Placed as 'marker' entities so the editor can display room labels.

function buildRoomMarkers(typedRooms, rows, cols) {
  const COLORS = {
    start:    '#3498db',
    normal:   '#7f8c8d',
    elite:    '#e67e22',
    treasure: '#f1c40f',
    boss:     '#e74c3c',
  };
  return typedRooms.map(room => ({
    id:       `marker_${room.id}`,
    type:     'marker',
    subtype:  room.roomType,
    position: _worldPos(Math.round(room.cy), Math.round(room.cx), rows, cols),
    facing:   'south',
    config:   { label: room.roomType.toUpperCase(), color: COLORS[room.roomType] ?? '#9b59b6' },
  }));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Populate a dungeon zone with encounters, entities, and a quest.
 *
 * @param {object} zone   Zone produced by generateDungeon (must have zone._rooms).
 * @returns {object}      New zone object with entities and zone.quest populated.
 */
export function populateDungeon(zone) {
  if (!zone?._rooms?.length) return zone;

  const next      = deepClone(zone);
  const typedRooms = zone._rooms;
  const rows      = zone.tiles.length;
  const cols      = zone.tiles[0].length;
  const maxDist   = Math.max(...typedRooms.map(r => r.dist ?? 0), 1);
  const rng       = mulberry32(zone.config?.seed ?? 0);

  // Clear existing non-spawn entities
  next.entities = (next.entities ?? []).filter(e => e.type === 'spawn');

  const allEntities = [...next.entities];

  // Place encounters in each room
  for (let i = 0; i < typedRooms.length; i++) {
    const room     = typedRooms[i];
    const template = TEMPLATES[room.roomType] ?? TEMPLATES.normal;
    const placed   = template(room, room.dist ?? 0, maxDist, rows, cols, rng, i);
    allEntities.push(...placed);
  }

  // Room type markers (shown in editor, ignored by runtime)
  allEntities.push(...buildRoomMarkers(typedRooms, rows, cols));

  next.entities = allEntities;
  next.quest    = buildQuest(typedRooms);

  return next;
}

// ── Room colour for editor rendering ─────────────────────────────────────────

export const ROOM_TYPE_COLORS = {
  start:    '#3498db',
  normal:   '#5a6a6a',
  elite:    '#e67e22',
  treasure: '#c8a010',
  boss:     '#c0392b',
};

export const ROOM_TYPE_LABELS = {
  start:    'START',
  normal:   'ROOM',
  elite:    'ELITE',
  treasure: 'CHEST',
  boss:     'BOSS',
};
