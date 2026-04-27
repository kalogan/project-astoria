import { Key, Door } from './entities.js';

const INTERACT_RADIUS = 1.5;

export class EntityManager {
  constructor(scene, defs) {
    this.keys  = [];
    this.doors = [];

    for (const def of defs) {
      if (def.type === 'key')  this.keys.push(new Key(scene, def));
      if (def.type === 'door') this.doors.push(new Door(scene, def));
    }
  }

  interact(playerPos, inventory) {
    for (const key of this.keys) {
      if (key.collected) continue;
      if (playerPos.distanceTo(key.mesh.position) <= INTERACT_RADIUS) {
        key.collect();
        inventory.add({ keyId: key.keyId });
      }
    }

    for (const door of this.doors) {
      if (!door.locked) continue;
      if (playerPos.distanceTo(door.mesh.position) <= INTERACT_RADIUS) {
        if (inventory.has(door.keyId)) door.unlock();
      }
    }
  }

  dispose(scene) {
    for (const k of this.keys)  scene.remove(k.mesh);
    for (const d of this.doors) scene.remove(d.mesh);
    this.keys  = [];
    this.doors = [];
  }
}
