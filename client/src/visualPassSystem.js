// Visual pass system — decorates a zone after tiles are placed.
//
// Pipeline: zoneGenerator → visualPassSystem.decorate(grid, scene, rng)
//                         → kitbashSystem (props)
//                         → styleEnforcer.correct() (final pass)
//
// Reads the raw tile grid (integers: 0=empty, 1=floor, 2=wall, 3=road).
// World coords follow tileRenderer convention: x = col − offsetX, z = row − offsetZ.

import * as THREE from 'three';
import { KitbashSystem } from './kitbashSystem.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TILE_FLOOR = 1;
const TILE_WALL  = 2;

// ── VisualPassSystem ──────────────────────────────────────────────────────────

export class VisualPassSystem {
  constructor() {
    this._kitbash      = new KitbashSystem();
    this._borderMeshes = [];
    this._scene        = null;
  }

  // ── Theme ─────────────────────────────────────────────────────────────────

  setTheme(name) {
    this._kitbash.setTheme(name);
  }

  getTheme() { return this._kitbash.getTheme(); }

  // ── Main decoration pass ──────────────────────────────────────────────────

  // Call once after tileRenderer has placed the tilemap.
  // grid: 2-D array of integers matching tileRenderer's format.
  decorate(grid, scene, rng) {
    this._scene = scene;
    this._borderMeshes = [];

    const rows    = grid.length;
    const cols    = grid[0]?.length ?? 0;
    const offsetX = (cols - 1) / 2;
    const offsetZ = (rows - 1) / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (grid[row][col] !== TILE_FLOOR) continue;

        const wx = col - offsetX;
        const wz = row - offsetZ;

        if (this._hasWallNeighbor(grid, row, col)) {
          this._placeBorderEdges(grid, row, col, wx, wz, scene);
        } else {
          this._kitbash.spawnProp(scene, wx, wz, rng);
        }
      }
    }
  }

  // ── Neighbors ─────────────────────────────────────────────────────────────

  _hasWallNeighbor(grid, row, col) {
    return _DIRS4.some(([dr, dc]) => grid[row + dr]?.[col + dc] === TILE_WALL);
  }

  // Place thin shadow-strip decals on floor tiles that face walls.
  // These simulate the soft shadow a wall casts onto the ground without
  // requiring the shadow map to cover every edge perfectly.
  _placeBorderEdges(grid, row, col, wx, wz, scene) {
    // Semi-transparent near-black overlay — reads as a contact shadow.
    // One shared material per call batch (theme-independent: shadows are always dark).
    const mat = _shadowStripMat();

    for (const [dr, dc] of _DIRS4) {
      if (grid[row + dr]?.[col + dc] !== TILE_WALL) continue;

      // Strip runs along the tile edge facing the wall, sitting just above the floor.
      const isNS = dc === 0;   // wall to north/south → strip parallel to X axis
      const geo  = isNS
        ? new THREE.BoxGeometry(1.0, 0.04, 0.18)   // wider/thinner than before
        : new THREE.BoxGeometry(0.18, 0.04, 1.0);
      const mesh = new THREE.Mesh(geo, mat);

      mesh.position.set(
        wx + dc * 0.41,
        0.21,                  // just above the floor top (floor top = 0.20)
        wz + dr * 0.41,
      );
      mesh.renderOrder       = 1;  // draw on top of floor tiles
      mesh.receiveShadow     = false;
      mesh.userData.isBorder = true;
      scene.add(mesh);
      this._borderMeshes.push(mesh);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  unload(scene) {
    const s = scene ?? this._scene;
    for (const m of this._borderMeshes) s?.remove(m);
    this._borderMeshes = [];
    this._kitbash.clearAll();
    this._scene = null;
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.log(`[VisualPass] theme=${this._kitbash.getTheme()}  borders=${this._borderMeshes.length}`);
    this._kitbash.inspect();
  }

  toggle() {
    this._kitbash.toggle();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const _DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Single cached semi-transparent shadow overlay material — shared by all strips.
let _cachedShadowMat = null;
function _shadowStripMat() {
  return _cachedShadowMat ??= new THREE.MeshBasicMaterial({
    color:       0x000000,
    transparent: true,
    opacity:     0.28,
    depthWrite:  false,   // don't occlude floor tiles behind it
  });
}
