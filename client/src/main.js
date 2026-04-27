import * as THREE from 'three';
import { createScene }   from './scene.js';
import { Player }        from './player.js';
import { Inventory }     from './inventory.js';
import { CombatSystem }  from './combatSystem.js';
import { HUD }           from './hud.js';
import { QuestSystem }   from './questSystem.js';
import { ZoneManager }   from './zoneManager.js';
import { getSave, saveGame, applySave } from './persistence.js';

const { scene, camera, renderer } = createScene();

const QUEST_DEFS = [
  { id: 'kill_all', type: 'kill', title: 'Exterminator', goal: 3 },
];

const inventory = new Inventory();
const questSys  = new QuestSystem(QUEST_DEFS);
const player    = new Player(scene, null); // collider set by zone on load
const hud       = new HUD(camera);

const combat = new CombatSystem(scene, { enemies: [] }, player, {
  onKill: () => {
    questSys.notify('kill');
    hud.setQuests(questSys.all());
  },
});

const zone = new ZoneManager(scene, combat, hud, player);

const saveCtx = { player, zone, combat, questSys, hud };

// Async startup
(async () => {
  const save = getSave();
  if (save?.activeZone) {
    await zone.load(save.activeZone);
    applySave(save, saveCtx);
  } else {
    await zone.load('zone_01');
  }

  hud.setInventory(inventory.items);
  hud.setQuests(questSys.all());

  window.addEventListener('beforeunload', () => saveGame(saveCtx));
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveGame(saveCtx); }
  });

  animate();
})();

const clock        = new THREE.Clock();
const cameraOffset = new THREE.Vector3(20, 20, 20);

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  player.update(delta);

  if (player.consumeInteract()) {
    zone.entities?.interact(player.mesh.position, inventory);
    hud.setInventory(inventory.items);
  }

  zone.update(delta, player.mesh.position);
  combat.update(delta, hud);

  hud.setPlayerHP(player.hp, player.maxHp);
  hud.updateEnemyLabels();
  hud.setDebugPos(player.mesh.position.x, player.mesh.position.y, player.mesh.position.z);

  camera.position.copy(player.mesh.position).add(cameraOffset);
  camera.lookAt(player.mesh.position);

  renderer.render(scene, camera);
}
