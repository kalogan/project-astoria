import { buildTileMap, unloadTileMap } from './tileRenderer.js';
import { Collider }        from './collider.js';
import { EntityManager }   from './entityManager.js';
import { EnemySystem }     from './enemySystem.js';
import { TriggerSystem }   from './triggerSystem.js';
import { setFrustumSize }  from './scene.js';

// Empirical constant: for frustumSize=22 the camera sees ±13.47 world units in Z
const VISIBLE_Z_PER_FRUSTUM = 13.47 / 22;

export class ZoneManager {
  constructor(scene, camera, renderer, combat, hud, player) {
    this.scene    = scene;
    this.camera   = camera;
    this.renderer = renderer;
    this.combat   = combat;
    this.hud      = hud;
    this.player   = player;

    this.activeId    = null;
    this.tileGroup   = null;
    this.collider    = null;
    this.entities    = null;
    this.enemySys    = null;
    this.triggers    = null;
    this.cameraBounds = null;
  }

  async load(zoneId, spawnPos = null) {
    const zone = await this._fetch(zoneId);
    this._unload();
    this.activeId = zone.id;

    const rows = zone.grid.length;
    const cols = zone.grid[0].length;
    const halfZ = (rows - 1) / 2;
    const halfX = (cols - 1) / 2;

    // Fit frustum to zone: visible half = gridHalf + 1 tile margin
    const newFrustumSize = (Math.max(halfZ, halfX) + 1) / VISIBLE_Z_PER_FRUSTUM;
    setFrustumSize(this.camera, this.renderer, newFrustumSize);

    // Camera can pan up to (gridHalf - visibleHalf) before revealing void
    const visibleHalf = newFrustumSize * VISIBLE_Z_PER_FRUSTUM;
    const maxPanZ = Math.max(0, halfZ - visibleHalf);
    const maxPanX = Math.max(0, halfX - visibleHalf);
    this.cameraBounds = { minX: -maxPanX, maxX: maxPanX, minZ: -maxPanZ, maxZ: maxPanZ };

    // Tiles + collider
    this.tileGroup       = buildTileMap(this.scene, zone.grid);
    this.collider        = new Collider(zone.grid);
    this.player.collider = this.collider;

    // Player spawn
    const spawn = spawnPos ?? zone.playerStart ?? { x: 0, z: 0 };
    this.player.mesh.position.set(spawn.x, 0.65, spawn.z);

    // Entities
    this.entities = new EntityManager(this.scene, zone.entities ?? []);

    // Enemies
    this.enemySys = new EnemySystem(this.scene, zone.grid, zone.enemies ?? []);
    this.combat.setEnemies(this.enemySys.enemies);
    this.hud.clearEnemyLabels();
    this.hud.initEnemyLabels(this.enemySys.enemies);

    // Triggers
    this.triggers = new TriggerSystem();
    for (const def of zone.triggers ?? []) this._registerTrigger(def);
  }

  update(delta, playerPos) {
    this.enemySys?.update(delta, playerPos);
    this.triggers?.update(playerPos);
  }

  _unload() {
    if (!this.activeId) return;
    if (this.tileGroup) { unloadTileMap(this.scene, this.tileGroup); this.tileGroup = null; }
    this.entities?.dispose(this.scene);
    this.enemySys?.dispose(this.scene);
    this.combat.clearLoot(this.scene);
    this.entities    = null;
    this.enemySys    = null;
    this.collider    = null;
    this.triggers    = null;
    this.cameraBounds = null;
    this.activeId    = null;
  }

  async _fetch(zoneId) {
    const res = await fetch(`/zones/${zoneId}.json`);
    if (!res.ok) throw new Error(`Zone not found: ${zoneId}`);
    return res.json();
  }

  _registerTrigger(def) {
    if (def.type !== 'area') return;
    const r2 = def.radius * def.radius;
    const condition = (pos) => {
      const dx = pos.x - def.x;
      const dz = pos.z - def.z;
      return (dx * dx + dz * dz) <= r2;
    };
    const actions = {
      unlockDoor: () => this.entities?.doors.find(d => d.id === def.doorId)?.unlock(),
      loadZone:   () => this.load(def.zoneId, { x: def.spawnX ?? 0, z: def.spawnZ ?? 0 }),
    };
    const action = actions[def.action];
    if (action) this.triggers.register({ condition, action, once: def.once ?? true });
  }
}
