import * as THREE from 'three';
import { createScene }     from './scene.js';
import { buildTileMap }    from './tileRenderer.js';
import { Collider }        from './collider.js';
import { Player }          from './player.js';
import { EntityManager }   from './entityManager.js';
import { Inventory }       from './inventory.js';
import { TriggerSystem, areaCondition } from './triggerSystem.js';

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

const ENTITY_DEFS = [
  { type: 'key',  id: 'key_red',   keyId: 'red',  x: -3, z:  0, color: 0xff4444 },
  { type: 'key',  id: 'key_blue',  keyId: 'blue', x:  0, z: -3, color: 0x4488ff },
  { type: 'door', id: 'door_red',  keyId: 'red',  x:  6, z:  0, color: 0x8b0000 },
  { type: 'door', id: 'door_blue', keyId: 'blue', x:  0, z: -6, color: 0x00008b },
];

const collider  = new Collider(grid);
const inventory = new Inventory();
const entities  = new EntityManager(scene, ENTITY_DEFS);
const player    = new Player(scene, collider);
const triggers  = new TriggerSystem();
const clock     = new THREE.Clock();
const cameraOffset = new THREE.Vector3(20, 20, 20);

// --- Trigger: unlock door ---
triggers.register({
  condition: areaCondition(3, 3, 1.5),
  action: () => {
    const door = entities.doors.find(d => d.id === 'door_red');
    door?.unlock();
  },
});

// --- Trigger: teleport player ---
triggers.register({
  condition: areaCondition(7, 0, 1),
  action: () => {
    player.mesh.position.set(-7, 0.65, 0);
  },
});

// --- Trigger: spawn enemy ---
triggers.register({
  condition: areaCondition(0, 4, 1.5),
  action: () => {
    const geo = new THREE.BoxGeometry(0.6, 0.9, 0.6);
    const mat = new THREE.MeshLambertMaterial({ color: 0xff6600 });
    const enemy = new THREE.Mesh(geo, mat);
    enemy.position.set(0, 0.65, 6);
    enemy.castShadow = true;
    scene.add(enemy);
  },
});

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  player.update(delta);
  if (player.consumeInteract()) entities.interact(player.mesh.position, inventory);
  triggers.update(player.mesh.position);

  camera.position.copy(player.mesh.position).add(cameraOffset);
  camera.lookAt(player.mesh.position);

  renderer.render(scene, camera);
}

animate();
