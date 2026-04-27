import * as THREE from 'three';

const TILE_SIZE = 1;

const TILE_DEFS = {
  1: { height: 0.2,  color: 0xc4a35a }, // floor
  2: { height: 1.5,  color: 0x607080 }, // wall
  3: { height: 0.2,  color: 0x3a3a3a }, // road
};

// Shared geometry + material caches — one per unique (height, color) pair
const geoCache = {};
const matCache = {};

function getGeometry(height) {
  if (!geoCache[height]) {
    geoCache[height] = new THREE.BoxGeometry(TILE_SIZE, height, TILE_SIZE);
  }
  return geoCache[height];
}

function getMaterial(color) {
  if (!matCache[color]) {
    matCache[color] = new THREE.MeshLambertMaterial({ color });
  }
  return matCache[color];
}

export function buildTileMap(scene, grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  // Center the grid at world origin
  const offsetX = (cols - 1) / 2;
  const offsetZ = (rows - 1) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const type = grid[row][col];
      if (type === 0) continue;

      const def = TILE_DEFS[type];
      if (!def) continue;

      const mesh = new THREE.Mesh(getGeometry(def.height), getMaterial(def.color));
      mesh.position.set(col - offsetX, def.height / 2, row - offsetZ);
      mesh.receiveShadow = true;
      mesh.castShadow = type === 2;
      scene.add(mesh);
    }
  }
}
