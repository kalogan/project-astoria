import { createScene } from './scene.js';
import { buildTileMap } from './tileRenderer.js';

const { scene, camera, renderer } = createScene();

// 0 = void, 1 = floor, 2 = wall, 3 = road
function generateGrid(rows, cols) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return 2; // border walls
      if (r === Math.floor(rows / 2) || c === Math.floor(cols / 2)) return 3; // cross road
      return 1; // floor
    })
  );
}

buildTileMap(scene, generateGrid(20, 20));

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

animate();
