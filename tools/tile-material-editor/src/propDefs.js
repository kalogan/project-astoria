// propDefs.js — prop type definitions for the map editor prop layer.
//
// zone.props = [{ id, type, x, y, offsetX, offsetY, rotation, scale }]
//
// anchor types:
//   "ground" — placed on tile surface
//   "wall"   — must be adjacent to a wall tile; auto-rotated to face away from wall
//   "edge"   — snaps to tile edges; used for fences, railings, etc.

import { TILE_TYPES } from './constants';

// ── Prop category definitions ─────────────────────────────────────────────────

export const PROP_CATEGORIES = {
  forest: 'Forest',
  city:   'City',
  dungeon: 'Dungeon',
  structure: 'Structure',
};

export const PROP_DEFS = {
  // ── Forest ───────────────────────────────────────────────────────────────────
  tree_small: {
    category: 'forest', label: 'Tree (small)',
    anchor: 'ground', width: 1, height: 1,
    color: '#2e6b3a', size: 1.0,
    blocking: true,
  },
  tree_large: {
    category: 'forest', label: 'Tree (large)',
    anchor: 'ground', width: 1, height: 1,
    color: '#1f4d2b', size: 1.5,
    blocking: true,
  },
  bush: {
    category: 'forest', label: 'Bush',
    anchor: 'ground', width: 1, height: 1,
    color: '#3f8a4f', size: 0.8,
    blocking: false,
  },
  rock_small: {
    category: 'forest', label: 'Rock',
    anchor: 'ground', width: 1, height: 1,
    color: '#6b6b6b', size: 0.7,
    blocking: false,
  },
  log: {
    category: 'forest', label: 'Log',
    anchor: 'ground', width: 1, height: 1,
    color: '#5a3b22', size: 1.0,
    blocking: false,
  },
  mushroom: {
    category: 'forest', label: 'Mushroom',
    anchor: 'ground', width: 1, height: 1,
    color: '#d45f3a', size: 0.5,
    blocking: false,
  },

  // ── City ─────────────────────────────────────────────────────────────────────
  barrel: {
    category: 'city', label: 'Barrel',
    anchor: 'ground', width: 1, height: 1,
    color: '#7a4a2a', size: 0.8,
    blocking: false,
  },
  crate: {
    category: 'city', label: 'Crate',
    anchor: 'ground', width: 1, height: 1,
    color: '#8b5a2b', size: 0.9,
    blocking: false,
  },
  torch: {
    category: 'city', label: 'Torch',
    anchor: 'wall', width: 1, height: 1,
    color: '#ffcc66', size: 0.6,
    blocking: false,
  },
  cart: {
    category: 'city', label: 'Cart',
    anchor: 'ground', width: 2, height: 1,
    color: '#6b4b2a', size: 1.4,
    blocking: true,
  },
  table: {
    category: 'city', label: 'Table',
    anchor: 'ground', width: 2, height: 1,
    color: '#5a3b22', size: 1.2,
    blocking: false,
  },
  sign: {
    category: 'city', label: 'Sign',
    anchor: 'wall', width: 1, height: 1,
    color: '#c09050', size: 0.7,
    blocking: false,
  },

  // ── Dungeon ──────────────────────────────────────────────────────────────────
  chest: {
    category: 'dungeon', label: 'Chest',
    anchor: 'ground', width: 1, height: 1,
    color: '#c8a810', size: 0.8,
    blocking: false,
  },
  pillar: {
    category: 'dungeon', label: 'Pillar',
    anchor: 'ground', width: 1, height: 1,
    color: '#888888', size: 0.9,
    blocking: true,
  },
  altar: {
    category: 'dungeon', label: 'Altar',
    anchor: 'ground', width: 2, height: 2,
    color: '#7070a0', size: 1.3,
    blocking: true,
  },
  bones: {
    category: 'dungeon', label: 'Bones',
    anchor: 'ground', width: 1, height: 1,
    color: '#d0c8b0', size: 0.6,
    blocking: false,
  },
  skull: {
    category: 'dungeon', label: 'Skull',
    anchor: 'ground', width: 1, height: 1,
    color: '#e0d8c0', size: 0.5,
    blocking: false,
  },

  // ── Structure / edge ─────────────────────────────────────────────────────────
  fence_wood: {
    category: 'structure', label: 'Fence (wood)',
    anchor: 'edge', width: 1, height: 1,
    color: '#7a5a30', size: 1.0,
    blocking: false,
  },
  fence_stone: {
    category: 'structure', label: 'Fence (stone)',
    anchor: 'edge', width: 1, height: 1,
    color: '#888878', size: 1.0,
    blocking: false,
  },
  door_wood: {
    category: 'structure', label: 'Door (wood)',
    anchor: 'wall', width: 1, height: 1,
    color: '#6b4020', size: 1.0,
    blocking: false,
  },
  window_small: {
    category: 'structure', label: 'Window',
    anchor: 'wall', width: 1, height: 1,
    color: '#a8d8f0', size: 0.8,
    blocking: false,
  },
};

// ── Wall detection ────────────────────────────────────────────────────────────
// Returns 'north'|'south'|'east'|'west' for the direction the prop should face
// (away from the wall it's attached to), or null if no wall is adjacent.

export function detectWallDirection(x, y, tiles) {
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;
  const WALL = TILE_TYPES.WALL;

  const checks = [
    { dir: 'south', dr: -1, dc:  0 },  // wall to north  → face south
    { dir: 'north', dr:  1, dc:  0 },  // wall to south  → face north
    { dir: 'east',  dr:  0, dc: -1 },  // wall to west   → face east
    { dir: 'west',  dr:  0, dc:  1 },  // wall to east   → face west
  ];
  for (const { dir, dr, dc } of checks) {
    const nr = y + dr, nc = x + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && tiles[nr][nc] === WALL)
      return dir;
  }
  return null;
}

// ── Overlap detection ─────────────────────────────────────────────────────────

export function canPlaceProp(x, y, propType, existingProps, tiles) {
  const def  = PROP_DEFS[propType];
  if (!def) return false;
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;

  // Bounds check across entire footprint
  for (let dy = 0; dy < def.height; dy++) {
    for (let dx = 0; dx < def.width; dx++) {
      const gx = x + dx, gy = y + dy;
      if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return false;
    }
  }

  // Wall-anchor props need an adjacent wall
  if (def.anchor === 'wall') {
    if (!detectWallDirection(x, y, tiles)) return false;
  }

  // Edge props skip overlap check (can chain)
  if (def.anchor === 'edge') return true;

  // Ground/wall props: no footprint overlap
  for (const other of existingProps) {
    const oDef = PROP_DEFS[other.type];
    if (!oDef) continue;
    const oW = oDef.width ?? 1, oH = oDef.height ?? 1;
    const dW = def.width    ?? 1, dH = def.height   ?? 1;
    // AABB overlap
    if (x < other.x + oW && x + dW > other.x &&
        y < other.y + oH && y + dH > other.y) return false;
  }
  return true;
}
