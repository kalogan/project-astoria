// dungeonGen.js — room-and-corridor dungeon generator.
//
// Algorithm:
//   1. Attempt to place `roomCount` non-overlapping rooms with random sizes.
//   2. Select "main rooms" (above-average area) for MST connection.
//   3. Build a minimum spanning tree (Prim's) over main room centres.
//   4. Optionally add a few extra edges (15% chance) for loops.
//   5. Carve L-shaped corridors between connected room pairs.
//   6. Assign room types (start, normal, elite, treasure, boss).
//
// Output:
//   - Standard zone JSON with tiles / entities arrays.
//   - zone._rooms: array of room objects used by questGen.js.

import { mulberry32, TILE_TYPES } from './constants';
import { WATER_TYPE } from './waterTile';

const FLOOR = TILE_TYPES.FLOOR;
const WALL  = TILE_TYPES.WALL;
const ROAD  = TILE_TYPES.ROAD;   // used for corridors

// ── Room placement ────────────────────────────────────────────────────────────

function tryPlaceRooms(count, minSize, maxSize, gridW, gridH, rng) {
  const rooms    = [];
  const PAD      = 2;
  const maxTries = count * 30;

  for (let attempt = 0; attempt < maxTries && rooms.length < count; attempt++) {
    const w  = minSize + Math.floor(rng() * (maxSize - minSize + 1));
    const h  = minSize + Math.floor(rng() * (maxSize - minSize + 1));
    const x  = PAD + Math.floor(rng() * (gridW - w - PAD * 2));
    const y  = PAD + Math.floor(rng() * (gridH - h - PAD * 2));
    const r  = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };

    const overlaps = rooms.some(e =>
      r.x < e.x + e.w + 1 && r.x + r.w + 1 > e.x &&
      r.y < e.y + e.h + 1 && r.y + r.h + 1 > e.y
    );
    if (!overlaps) rooms.push(r);
  }

  return rooms;
}

// ── Main room selection ───────────────────────────────────────────────────────
// Main rooms: area > average * 0.9

function selectMainRooms(rooms) {
  const avgArea = rooms.reduce((s, r) => s + r.w * r.h, 0) / rooms.length;
  const main    = rooms.filter(r => r.w * r.h >= avgArea * 0.9);
  // Guarantee at least 2 main rooms
  if (main.length < 2) return rooms.slice(0, Math.min(rooms.length, 2));
  return main;
}

// ── Minimum spanning tree (Prim's) ────────────────────────────────────────────

function buildMST(rooms, rng) {
  if (rooms.length <= 1) return [];
  const connected = new Set([0]);
  const edges     = [];

  while (connected.size < rooms.length) {
    let best = null;
    for (const i of connected) {
      for (let j = 0; j < rooms.length; j++) {
        if (connected.has(j)) continue;
        const dx   = rooms[i].cx - rooms[j].cx;
        const dy   = rooms[i].cy - rooms[j].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (!best || dist < best.dist) best = { i, j, dist };
      }
    }
    if (!best) break;
    connected.add(best.j);
    edges.push([best.i, best.j]);
  }

  // Optional extra edges for loops (~15% of extra pairs)
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) {
      if (edges.some(([i, j]) => (i === a && j === b) || (i === b && j === a))) continue;
      if (rng() < 0.15) edges.push([a, b]);
    }
  }

  return edges;
}

// ── Corridor carving ──────────────────────────────────────────────────────────
// L-shaped: horizontal then vertical (or vice versa based on rng).

function carveCorridors(tiles, rooms, edges, rng) {
  const rows = tiles.length;
  const cols = tiles[0].length;

  for (const [ai, bi] of edges) {
    const a   = rooms[ai], b = rooms[bi];
    const ax  = Math.round(a.cx), ay = Math.round(a.cy);
    const bx  = Math.round(b.cx), by = Math.round(b.cy);
    const hFirst = rng() < 0.5;

    if (hFirst) {
      // Horizontal segment at ay
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
      for (let x = x0; x <= x1; x++)
        if (ay >= 0 && ay < rows && x >= 0 && x < cols && tiles[ay][x] === WALL)
          tiles[ay][x] = ROAD;
      // Vertical segment at bx
      const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      for (let y = y0; y <= y1; y++)
        if (y >= 0 && y < rows && bx >= 0 && bx < cols && tiles[y][bx] === WALL)
          tiles[y][bx] = ROAD;
    } else {
      // Vertical segment at ax
      const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      for (let y = y0; y <= y1; y++)
        if (y >= 0 && y < rows && ax >= 0 && ax < cols && tiles[y][ax] === WALL)
          tiles[y][ax] = ROAD;
      // Horizontal segment at by
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
      for (let x = x0; x <= x1; x++)
        if (by >= 0 && by < rows && x >= 0 && x < cols && tiles[by][x] === WALL)
          tiles[by][x] = ROAD;
    }
  }
}

// ── Room carving ──────────────────────────────────────────────────────────────

function carveRooms(tiles, rooms) {
  const rows = tiles.length;
  const cols = tiles[0].length;
  for (const room of rooms) {
    for (let r = room.y; r < room.y + room.h && r < rows; r++)
      for (let c = room.x; c < room.x + room.w && c < cols; c++)
        tiles[r][c] = FLOOR;
  }
}

// ── Room type assignment ──────────────────────────────────────────────────────
// Uses BFS distance from the start room on the MST graph.

function assignRoomTypes(mainRooms, edges) {
  if (!mainRooms.length) return [];

  // Build adjacency for BFS
  const adj = Array.from({ length: mainRooms.length }, () => []);
  for (const [a, b] of edges) {
    if (a < mainRooms.length && b < mainRooms.length) {
      adj[a].push(b);
      adj[b].push(a);
    }
  }

  // BFS from room 0
  const dist = new Array(mainRooms.length).fill(-1);
  dist[0] = 0;
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of adj[cur]) {
      if (dist[nb] === -1) {
        dist[nb] = dist[cur] + 1;
        queue.push(nb);
      }
    }
  }
  // Fill unreachable rooms
  for (let i = 0; i < dist.length; i++) if (dist[i] === -1) dist[i] = 0;

  const maxDist = Math.max(...dist);
  const types   = new Array(mainRooms.length).fill('normal');
  types[0] = 'start';

  // Boss: furthest from start
  const bossIdx = dist.indexOf(maxDist);
  types[bossIdx] = 'boss';

  // Elite and treasure (skip start and boss)
  for (let i = 1; i < mainRooms.length; i++) {
    if (types[i] !== 'normal') continue;
    const ratio = dist[i] / Math.max(maxDist, 1);
    if (ratio >= 0.65 && Math.random() < 0.4) types[i] = 'elite';
    else if (ratio >= 0.3 && Math.random() < 0.2)  types[i] = 'treasure';
  }

  return mainRooms.map((room, i) => ({
    ...room,
    id:       `room_${i}`,
    roomType: types[i],
    dist:     dist[i],
  }));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a dungeon zone.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.roomCount    target number of rooms
 * @param {number} opts.minRoomSize  minimum room dimension
 * @param {number} opts.maxRoomSize  maximum room dimension
 * @param {number} opts.seed
 * @returns {object} zone object with zone._rooms for questGen
 */
export function generateDungeon({
  width       = 60,
  height      = 60,
  roomCount   = 12,
  minRoomSize = 4,
  maxRoomSize = 10,
  seed        = 12345,
}) {
  const rng = mulberry32(seed);

  // Initialise all walls
  const tiles = Array.from({ length: height }, () => Array(width).fill(WALL));

  // Place rooms
  const allRooms  = tryPlaceRooms(roomCount, minRoomSize, maxRoomSize, width, height, rng);
  const mainRooms = selectMainRooms(allRooms);

  // Connect main rooms
  const edges = buildMST(mainRooms, rng);

  // Carve ALL rooms and corridors
  carveRooms(tiles, allRooms);
  carveCorridors(tiles, mainRooms, edges, rng);

  // Assign room types
  const typedRooms = assignRoomTypes(mainRooms, edges);

  // Player starts in start room
  const startRoom  = typedRooms.find(r => r.roomType === 'start') ?? typedRooms[0];
  const spawnX     = Math.round(startRoom?.cx ?? width  / 2) - width  / 2;
  const spawnZ     = Math.round(startRoom?.cy ?? height / 2) - height / 2;

  const entities = [];
  if (startRoom) {
    entities.push({
      id:       'spawn_player_start',
      type:     'spawn',
      subtype:  'player',
      position: { x: spawnX, y: 0, z: spawnZ },
      facing:   'south',
      config:   {},
    });
  }

  return {
    id:          `dungeon_${seed}`,
    name:        `Dungeon (seed ${seed})`,
    type:        'surface',
    config:      { width, height, seed },
    playerStart: { x: spawnX, z: spawnZ },
    tiles,
    entities,
    systems:     { keys: [], doors: [], enemies: [], portals: [], quests: [] },
    _rooms:      typedRooms,   // kept for questGen; ignored by game runtime
    _allRooms:   allRooms,
    _edges:      edges,
  };
}
