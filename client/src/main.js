import * as THREE from 'three';
import { createScene }     from './scene.js';
import { buildTileMap }    from './tileRenderer.js';
import { Collider }        from './collider.js';
import { Player }          from './player.js';
import { EntityManager }   from './entityManager.js';
import { Inventory }       from './inventory.js';
import { TriggerSystem, areaCondition } from './triggerSystem.js';
import { EnemySystem }     from './enemySystem.js';
import { CombatSystem }    from './combatSystem.js';
import { HUD }             from './hud.js';
import { QuestSystem }     from './questSystem.js';
import { saveGame, loadGame } from './persistence.js';

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

const ENEMY_DEFS = [
  { x:  4, z:  4 },
  { x: -4, z:  4 },
  { x:  4, z: -4 },
];

const QUEST_DEFS = [
  { id: 'kill_all', type: 'kill', title: 'Exterminator', goal: 3 },
];

const collider  = new Collider(grid);
const inventory = new Inventory();
const entities  = new EntityManager(scene, ENTITY_DEFS);
const enemySys  = new EnemySystem(scene, grid, ENEMY_DEFS);
const questSys  = new QuestSystem(QUEST_DEFS);
const player    = new Player(scene, collider);
const hud       = new HUD(camera);
const combat    = new CombatSystem(scene, enemySys, player, {
  onKill: () => {
    questSys.notify('kill');
    hud.setQuests(questSys.all());
  },
});
const triggers  = new TriggerSystem();

const saveCtx = { player, entities, enemySys, combat, triggers, questSys, hud };

triggers.register({
  condition: areaCondition(3, 3, 1.5),
  action: () => entities.doors.find(d => d.id === 'door_red')?.unlock(),
});
triggers.register({
  condition: areaCondition(7, 0, 1),
  action: () => { player.mesh.position.set(-7, 0.65, 0); },
});

// Init HUD
hud.initEnemyLabels(enemySys.enemies);
hud.setInventory(inventory.items);
hud.setQuests(questSys.all());

// Load save if exists
loadGame(saveCtx);

// Auto-save on unload + Ctrl+S
window.addEventListener('beforeunload', () => saveGame(saveCtx));
window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveGame(saveCtx); }
});

const clock        = new THREE.Clock();
const cameraOffset = new THREE.Vector3(20, 20, 20);

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  player.update(delta);
  if (player.consumeInteract()) {
    entities.interact(player.mesh.position, inventory);
    hud.setInventory(inventory.items);
  }

  triggers.update(player.mesh.position);
  enemySys.update(delta, player.mesh.position);
  combat.update(delta, hud);

  hud.setPlayerHP(player.hp, player.maxHp);
  hud.updateEnemyLabels();

  camera.position.copy(player.mesh.position).add(cameraOffset);
  camera.lookAt(player.mesh.position);

  renderer.render(scene, camera);
}

animate();
