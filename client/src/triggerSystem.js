export class TriggerSystem {
  constructor(player) {
    this.player   = player;
    this.registry = null;
    this.triggers = [];
  }

  init(_zone, registry, _eventBus, rng = null) {
    this.registry = registry;
    this.rng      = rng;
  }

  register(trigger) {
    this.triggers.push({ once: true, fired: false, ...trigger });
  }

  update(_delta) {
    const playerPos = this.player.mesh.position;
    for (const t of this.triggers) {
      if (t.fired && t.once) continue;
      if (t.condition(playerPos)) {
        t.action(playerPos);
        t.fired = true;
      }
    }
  }

  onEvent(_event) {}
}

// --- Condition factories ---

export function areaCondition(x, z, radius) {
  return (pos) => {
    const dx = pos.x - x;
    const dz = pos.z - z;
    return (dx * dx + dz * dz) <= radius * radius;
  };
}
