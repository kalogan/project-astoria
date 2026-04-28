// prefabDefs.js — reusable multi-part structure templates.
//
// A prefab is stamped into zone.tiles + zone.props when placed.
// `origin` is the cursor attachment point within the prefab grid.
//
// Tile legend used in pattern arrays:
//   0 = empty (don't overwrite)   1 = FLOOR   2 = WALL   3 = ROAD

import { TILE_TYPES } from '../constants';

const F = TILE_TYPES.FLOOR;   // 1
const W = TILE_TYPES.WALL;    // 2
const R = TILE_TYPES.ROAD;    // 3
const _ = 0;                  // leave as-is

export const PREFABS = {

  // 5×5 small house (outer walls, open interior)
  house_small: {
    label:  'House (small)',
    category: 'building',
    width: 5, height: 5,
    origin: { x: 2, y: 4 },    // bottom-centre tile = cursor
    tiles: [
      [W, W, W, W, W],
      [W, F, F, F, W],
      [W, F, F, F, W],
      [W, F, F, F, W],
      [W, W, F, W, W],          // door gap at x=2
    ],
    props: [
      { type: 'door_wood',  x: 2, y: 4, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
      { type: 'table',      x: 1, y: 2, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
      { type: 'barrel',     x: 3, y: 1, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
    ],
    entities: [],
  },

  // 7×7 dungeon room
  dungeon_room: {
    label:  'Dungeon Room',
    category: 'dungeon',
    width: 7, height: 7,
    origin: { x: 3, y: 6 },
    tiles: [
      [W, W, W, W, W, W, W],
      [W, F, F, F, F, F, W],
      [W, F, F, F, F, F, W],
      [W, F, F, F, F, F, W],
      [W, F, F, F, F, F, W],
      [W, F, F, F, F, F, W],
      [W, W, W, F, W, W, W],    // south door gap
    ],
    props: [
      { type: 'pillar', x: 1, y: 1, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
      { type: 'pillar', x: 5, y: 1, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
      { type: 'chest',  x: 3, y: 2, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
      { type: 'bones',  x: 2, y: 4, offsetX: 0.15, offsetY: 0, rotation: 0.8, scale: 0.9 },
    ],
    entities: [],
  },

  // 3×3 campsite
  campsite: {
    label:  'Campsite',
    category: 'forest',
    width: 3, height: 3,
    origin: { x: 1, y: 2 },
    tiles: [
      [F, F, F],
      [F, F, F],
      [F, F, F],
    ],
    props: [
      { type: 'log',       x: 0, y: 1, offsetX:  0.1, offsetY:  0.1, rotation: 0.4,  scale: 0.9 },
      { type: 'log',       x: 2, y: 1, offsetX: -0.1, offsetY: -0.1, rotation: -0.3, scale: 0.85},
      { type: 'rock_small',x: 1, y: 1, offsetX:  0,   offsetY:  0,   rotation: 0,    scale: 0.8 },
      { type: 'tree_small',x: 0, y: 0, offsetX:  0,   offsetY:  0,   rotation: 0,    scale: 1   },
      { type: 'tree_small',x: 2, y: 0, offsetX:  0,   offsetY:  0,   rotation: 0,    scale: 1.1 },
      { type: 'bush',      x: 0, y: 2, offsetX:  0.2, offsetY:  0,   rotation: 0.2,  scale: 0.9 },
    ],
    entities: [],
  },

  // 4×1 road segment
  road_segment: {
    label:  'Road (4-tile)',
    category: 'city',
    width: 4, height: 1,
    origin: { x: 0, y: 0 },
    tiles: [
      [R, R, R, R],
    ],
    props: [],
    entities: [],
  },

  // 3×3 market stall
  market_stall: {
    label:  'Market Stall',
    category: 'city',
    width: 3, height: 2,
    origin: { x: 1, y: 1 },
    tiles: [
      [F, F, F],
      [F, F, F],
    ],
    props: [
      { type: 'table',  x: 0, y: 0, offsetX: 0, offsetY: 0, rotation: 0, scale: 1   },
      { type: 'table',  x: 2, y: 0, offsetX: 0, offsetY: 0, rotation: 0, scale: 1   },
      { type: 'barrel', x: 0, y: 1, offsetX: 0, offsetY: 0, rotation: 0, scale: 0.9 },
      { type: 'crate',  x: 2, y: 1, offsetX: 0, offsetY: 0, rotation: 0, scale: 0.9 },
      { type: 'sign',   x: 1, y: 0, offsetX: 0, offsetY: 0, rotation: 0, scale: 1   },
    ],
    entities: [],
  },
};

// ── Rotation helpers ──────────────────────────────────────────────────────────
// Returns a new { tiles, props, origin } rotated by `steps` × 90° clockwise.

function _rotateTiles90(tiles) {
  const rows = tiles.length, cols = tiles[0].length;
  return Array.from({ length: cols }, (_, c) =>
    Array.from({ length: rows }, (_, r) => tiles[rows - 1 - r][c])
  );
}

function _rotatePoint90(x, y, w, _h) {
  // 90° CW: (x, y) → (W-1-y, x)  (within new grid of size h×w)
  return { x: w - 1 - y, y: x };
}

export function rotatePrefab(prefab, steps) {
  let { tiles, props, origin, width, height } = prefab;
  let w = width, h = height;

  for (let s = 0; s < (steps % 4); s++) {
    tiles  = _rotateTiles90(tiles);
    const newH = w, newW = h;
    props  = props.map(p => {
      const np = _rotatePoint90(p.x, p.y, w, h);
      return { ...p, x: np.x, y: np.y, rotation: (p.rotation ?? 0) + Math.PI / 2 };
    });
    origin = _rotatePoint90(origin.x, origin.y, w, h);
    w = newW; h = newH;
  }

  return { ...prefab, tiles, props, origin, width: w, height: h };
}

// ── Bounds / overlap validation ────────────────────────────────────────────────

export function canPlacePrefab(x, y, prefab, zone) {
  const { tiles, props, width, height } = prefab;
  const rows = zone.tiles.length;
  const cols = zone.tiles[0]?.length ?? 0;

  // Grid bounds
  if (x < 0 || y < 0 || x + width > cols || y + height > rows) return false;

  // Prop overlap
  const existingProps = zone.props ?? [];
  for (const pp of props) {
    const px = x + pp.x, py = y + pp.y;
    for (const ep of existingProps) {
      if (Math.abs(ep.x - px) < 1 && Math.abs(ep.y - py) < 1) return false;
    }
  }

  return true;
}

// ── Apply prefab ───────────────────────────────────────────────────────────────
// Returns a new zone with tiles stamped and props appended.
// mode: 'stamp' (overwrite) | 'merge' (only fill empty tiles)

export function applyPrefab(zone, x, y, prefab, mode = 'stamp') {
  const next  = { ...zone, tiles: zone.tiles.map(r => [...r]), props: [...(zone.props ?? [])] };
  const stamp = mode === 'stamp';

  for (let dy = 0; dy < prefab.height; dy++) {
    for (let dx = 0; dx < prefab.width; dx++) {
      const tv = prefab.tiles[dy]?.[dx] ?? 0;
      if (tv === 0) continue;
      const gy = y + dy, gx = x + dx;
      if (gy < 0 || gy >= next.tiles.length || gx < 0 || gx >= next.tiles[0].length) continue;
      if (stamp || next.tiles[gy][gx] === 0) next.tiles[gy][gx] = tv;
    }
  }

  const idBase = `prefab_${Date.now()}`;
  for (const pp of prefab.props) {
    next.props.push({
      ...pp,
      id: `${idBase}_${pp.type}_${pp.x}_${pp.y}`,
      x:  x + pp.x,
      y:  y + pp.y,
    });
  }

  for (const ent of prefab.entities ?? []) {
    const entities = next.entities ?? [];
    const rows = next.tiles.length, cols = next.tiles[0].length;
    entities.push({
      ...ent,
      id: `${idBase}_ent_${ent.type}`,
      position: {
        x: (x + (ent.x ?? 0)) - cols / 2,
        y: 0,
        z: (y + (ent.y ?? 0)) - rows / 2,
      },
    });
    next.entities = entities;
  }

  return next;
}
