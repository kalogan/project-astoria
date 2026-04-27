export class TriggerSystem {
  constructor() {
    this.triggers = [];
  }

  // register({ condition, action, once = true })
  register(trigger) {
    this.triggers.push({ once: true, fired: false, ...trigger });
  }

  update(playerPos) {
    for (const t of this.triggers) {
      if (t.fired && t.once) continue;
      if (t.condition(playerPos)) {
        t.action(playerPos);
        t.fired = true;
      }
    }
  }
}

// --- Condition factories ---

export function areaCondition(x, z, radius) {
  return (pos) => {
    const dx = pos.x - x;
    const dz = pos.z - z;
    return (dx * dx + dz * dz) <= radius * radius;
  };
}
