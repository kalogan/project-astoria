// tileRenderer.js — tile-map builder with per-tile visual depth.
//
// Every tile gets a deterministic colour selected from a type-specific palette
// based on a fast hash of its (row, col) position.  Tiles at type boundaries
// (floor↔path, floor↔wall) receive blended transition colours so edges
// read as organic rather than hard-cut.
//
// Geometry is shared (one BoxGeometry per height value).
// Materials are cached by hex colour (≈ 20 unique materials total across all zones).

import * as THREE from 'three';

const TILE_SIZE = 1;

// ── Tile heights ──────────────────────────────────────────────────────────────

const TILE_HEIGHT = {
  1: 0.2,    // floor
  2: 1.5,    // wall
  3: 0.2,    // road / worn path
};

// ── Geometry cache (shared — never disposed) ──────────────────────────────────

const _geoCache = {};
function _geo(height) {
  return _geoCache[height] ??= new THREE.BoxGeometry(TILE_SIZE, height, TILE_SIZE);
}

// ── Material cache (shared — never disposed) ──────────────────────────────────
// Keyed by hex integer.  OcclusionSystem clones individual wall mats as needed.

const _matCache = new Map();
function _mat(hex) {
  if (!_matCache.has(hex)) {
    _matCache.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
  }
  return _matCache.get(hex);
}

// ── Colour palettes ───────────────────────────────────────────────────────────
// 5 shades per tile type.  Small variation preserves theme while breaking
// the perfectly uniform look.

const PAL = {
  //           [0]        [1]        [2]        [3]        [4]
  // ── floor — warm sandy earth ──────────────────────────────────────────────
  1: [ 0xc4a35a, 0xc9aa62, 0xbd9c50, 0xc7a455, 0xba9e56 ],

  // ── wall — cool stone blue-gray ───────────────────────────────────────────
  2: [ 0x607080, 0x5a6c7c, 0x687484, 0x5d6e78, 0x637278 ],

  // ── road — dark worn stone ────────────────────────────────────────────────
  3: [ 0x3c3c3c, 0x383838, 0x3e3b36, 0x363636, 0x3a3a38 ],
};

// ── Transition colours ────────────────────────────────────────────────────────
// Applied stochastically to tiles at type boundaries.

const T = {
  FLOOR_NEAR_WALL: 0xb69248,  // darker, shadow-stained earth at building bases
  FLOOR_NEAR_PATH: 0xbb9c50,  // slightly worn earth where grass meets path
  PATH_NEAR_FLOOR: 0x3f3d38,  // slightly lighter path edge meeting grass
};

// Transition probability per tile (probability that the transition colour wins)
const T_PROB = {
  FLOOR_NEAR_WALL: 0.50,
  FLOOR_NEAR_PATH: 0.55,
  PATH_NEAR_FLOOR: 0.45,
};

// ── Fast deterministic hash ───────────────────────────────────────────────────
// Maps (row, col) → float in [0, 1).  Same inputs always produce same output.

function _hash(row, col) {
  let n = (Math.imul(row, 2999) ^ Math.imul(col, 7919)) | 0;
  n ^= (n >>> 16);
  n  = Math.imul(n, 0x45d9f3b | 0);
  n ^= (n >>> 16);
  return (n >>> 0) / 0x100000000;
}

// ── Neighbour type check ──────────────────────────────────────────────────────

function _hasNeighbour(grid, row, col, type) {
  const R = grid.length, C = grid[0].length;
  return (
    (row > 0     && grid[row - 1][col] === type) ||
    (row < R - 1 && grid[row + 1][col] === type) ||
    (col > 0     && grid[row][col - 1] === type) ||
    (col < C - 1 && grid[row][col + 1] === type)
  );
}

// ── Per-tile material selector ────────────────────────────────────────────────

function _pickMat(type, row, col, grid) {
  const t = _hash(row, col);

  switch (type) {
    case 1: {  // floor
      if (_hasNeighbour(grid, row, col, 2) && t < T_PROB.FLOOR_NEAR_WALL)
        return _mat(T.FLOOR_NEAR_WALL);
      if (_hasNeighbour(grid, row, col, 3) && t < T_PROB.FLOOR_NEAR_PATH)
        return _mat(T.FLOOR_NEAR_PATH);
      return _mat(PAL[1][(t * PAL[1].length) | 0]);
    }

    case 2:  // wall
      return _mat(PAL[2][(t * PAL[2].length) | 0]);

    case 3: {  // road / path
      if (_hasNeighbour(grid, row, col, 1) && t < T_PROB.PATH_NEAR_FLOOR)
        return _mat(T.PATH_NEAR_FLOOR);
      return _mat(PAL[3][(t * PAL[3].length) | 0]);
    }

    default:
      return _mat(0x808080);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a tile-map Group from a 2-D grid.
 *
 * @param {THREE.Scene}  scene
 * @param {number[][]}   grid
 * @param {Array<{id, minRow, maxRow, minCol, maxCol}>} [rooms=[]]
 *   Room definitions — wall tiles inside a room's bounds receive userData.roomId
 *   so OcclusionSystem can find and fade them.
 */
export function buildTileMap(scene, grid, rooms = []) {
  const rows    = grid.length;
  const cols    = grid[0].length;
  const offsetX = (cols - 1) / 2;
  const offsetZ = (rows - 1) / 2;
  const group   = new THREE.Group();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const type   = grid[row][col];
      if (type === 0) continue;
      const height = TILE_HEIGHT[type];
      if (height == null) continue;

      const mesh = new THREE.Mesh(_geo(height), _pickMat(type, row, col, grid));
      mesh.position.set(col - offsetX, height / 2, row - offsetZ);
      mesh.receiveShadow = true;
      mesh.castShadow    = type === 2;

      // ── userData tags ───────────────────────────────────────────────────
      mesh.userData.tileType = type;

      if (type === 2 && rooms.length) {
        for (const room of rooms) {
          if (row >= room.minRow && row <= room.maxRow &&
              col >= room.minCol && col <= room.maxCol) {
            mesh.userData.roomId = room.id;
            break;
          }
        }
      }

      group.add(mesh);
    }
  }

  scene.add(group);
  return group;
}

export function unloadTileMap(scene, group) {
  scene.remove(group);
  // Geometries and materials are shared — never disposed here.
}
