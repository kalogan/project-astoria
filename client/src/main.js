import { createScene } from './scene.js';

const { scene, camera, renderer, cube } = createScene();

function animate() {
  requestAnimationFrame(animate);
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}

animate();
