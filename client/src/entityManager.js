// Interaction system — queries EntityRegistry, never owns entity arrays.

const INTERACT_RADIUS = 1.5;

export class EntityManager {
  constructor() {
    this.registry = null;
    this.eventBus = null;
    this.onSave   = null; // () => void — wired by ZoneManager for zone-state snapshots
  }

  init(_zone, registry, eventBus, rng = null) {
    this.registry = registry;
    this.eventBus = eventBus ?? null;
    this.rng      = rng;
  }

  interact(playerPos, inventory) {
    if (!this.registry) return;

    for (const key of this.registry.getEntitiesByType('key')) {
      if (key.collected) continue;
      if (playerPos.distanceTo(key.mesh.position) <= INTERACT_RADIUS) {
        key.collect();
        inventory.add({ keyId: key.keyId });
        this.eventBus?.emit('key_collected', { keyId: key.keyId, entityId: key.id });
        this.onSave?.();
      }
    }

    for (const door of this.registry.getEntitiesByType('door')) {
      if (!door.locked) continue;
      if (playerPos.distanceTo(door.mesh.position) <= INTERACT_RADIUS) {
        if (inventory.has(door.keyId)) {
          door.unlock();
          this.eventBus?.emit('door_unlocked', { entityId: door.id, keyId: door.keyId });
          this.onSave?.();
        }
      }
    }
  }

  update(_delta) {}
  onEvent(_event) {}
}
