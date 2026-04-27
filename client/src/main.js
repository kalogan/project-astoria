import * as THREE from 'three';
import { createScene } from './scene.js';
import { buildTileMap } from './tileRenderer.js';
import { Collider } from './collider.js';
import { Player } from './player.js';

const { scene, camera, renderer } = createScene();

function generateGrid(rows, cols) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return 2;
      if (r === Math.floor(rows / 2) || c === Math.floor(cols / 2)) return 3;
      return 1;
    })
  );
}

const grid = generateGrid(20, 20);
buildTileMap(scene, grid);

const collider = new Collider(grid);
const player = new Player(scene, collider);
const clock = new THREE.Clock();
const cameraOffset = new THREE.Vector3(20, 20, 20);

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  player.update(delta);

  camera.position.copy(player.mesh.position).add(cameraOffset);
  camera.lookAt(player.mesh.position);

  renderer.render(scene, camera);
}

animate();
