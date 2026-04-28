// lootTables.js — data-driven loot generation for container entities.
//
// Containers are entities with:
//   { type: 'container', subtype: 'chest'|'barrel'|'crate',
//     config: { lootTableId, opened: false, contents: [], seed: <number> } }
//
// generateLoot(tableId, seed) is deterministic given the same seed,
// so container contents are stable across editor reloads.

// ── Loot table definitions ────────────────────────────────────────────────────
// Each entry: { item, label, min, max, weight }
// Weight is relative (higher = more common).

export const LOOT_TABLES = {
  basic_chest: [
    { item: 'gold',   label: 'Gold',    min: 10, max: 50,  weight: 100 },
    { item: 'potion', label: 'Potion',  min: 1,  max: 2,   weight: 55  },
    { item: 'arrows', label: 'Arrows',  min: 5,  max: 20,  weight: 45  },
    { item: 'sword',  label: 'Sword',   min: 1,  max: 1,   weight: 12  },
    { item: 'armor',  label: 'Armor',   min: 1,  max: 1,   weight: 8   },
    { item: 'key',    label: 'Key',     min: 1,  max: 1,   weight: 5   },
  ],
  barrel: [
    { item: 'gold',  label: 'Gold',   min: 1,  max: 12,  weight: 60  },
    { item: 'food',  label: 'Food',   min: 1,  max: 3,   weight: 65  },
    { item: 'rope',  label: 'Rope',   min: 1,  max: 1,   weight: 22  },
    { item: 'torch', label: 'Torch',  min: 1,  max: 2,   weight: 18  },
    { item: 'empty', label: '(empty)', min: 0, max: 0,   weight: 28  },
  ],
  crate: [
    { item: 'gold',   label: 'Gold',    min: 5,  max: 28,  weight: 75  },
    { item: 'arrows', label: 'Arrows',  min: 5,  max: 20,  weight: 60  },
    { item: 'torch',  label: 'Torch',   min: 1,  max: 3,   weight: 42  },
    { item: 'rope',   label: 'Rope',    min: 1,  max: 2,   weight: 28  },
    { item: 'potion', label: 'Potion',  min: 1,  max: 1,   weight: 20  },
  ],
  boss_chest: [
    { item: 'gold',        label: 'Gold',             min: 100, max: 500, weight: 100 },
    { item: 'rare_gem',    label: 'Rare Gem',          min: 1,   max: 2,   weight: 40  },
    { item: 'leg_weapon',  label: 'Legendary Weapon',  min: 1,   max: 1,   weight: 15  },
    { item: 'potion',      label: 'Potion',            min: 2,   max: 5,   weight: 80  },
    { item: 'key',         label: 'Key',               min: 1,   max: 3,   weight: 50  },
    { item: 'armor',       label: 'Armor',             min: 1,   max: 1,   weight: 20  },
  ],
  dungeon_chest: [
    { item: 'gold',     label: 'Gold',     min: 30,  max: 120, weight: 90  },
    { item: 'potion',   label: 'Potion',   min: 1,   max: 3,   weight: 60  },
    { item: 'sword',    label: 'Sword',    min: 1,   max: 1,   weight: 25  },
    { item: 'rare_gem', label: 'Rare Gem', min: 1,   max: 1,   weight: 15  },
    { item: 'key',      label: 'Key',      min: 1,   max: 2,   weight: 30  },
  ],
};

// Default loot table by container subtype
export const CONTAINER_LOOT_TABLES = {
  chest:  'basic_chest',
  barrel: 'barrel',
  crate:  'crate',
  altar:  'boss_chest',
};

// ── Deterministic seeded RNG ─────────────────────────────────────────────────

function _seededRng(seed) {
  let s = (seed | 0) ^ 0xdeadbeef;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d | 0);
    s = Math.imul(s ^ (s >>> 12), 0x297a2d39 | 0);
    s = (s ^ (s >>> 15)) >>> 0;
    return s / 0x100000000;
  };
}

// ── Loot generation ────────────────────────────────────────────────────────────
//
// Returns an array of { item, label, qty } objects.
// Given the same tableId and seed, always produces the same result.

export function generateLoot(tableId, seed = Math.floor(Math.random() * 1e9)) {
  const table = LOOT_TABLES[tableId] ?? LOOT_TABLES.basic_chest;
  const rng   = _seededRng(seed);

  const totalWeight = table.reduce((s, e) => s + e.weight, 0);
  const rolls       = 1 + Math.floor(rng() * 3);  // 1–3 item types
  const used        = new Set();
  const loot        = [];

  for (let r = 0; r < rolls; r++) {
    let pick = rng() * totalWeight;
    for (const entry of table) {
      pick -= entry.weight;
      if (pick > 0) continue;
      if (used.has(entry.item)) break;
      used.add(entry.item);
      if (entry.item === 'empty') break;
      const qty = entry.min + Math.floor(rng() * Math.max(1, entry.max - entry.min + 1));
      loot.push({ item: entry.item, label: entry.label, qty });
      break;
    }
  }

  return loot.length > 0 ? loot : [{ item: 'empty', label: '(empty)', qty: 0 }];
}

// ── Item display helpers ──────────────────────────────────────────────────────

export const ITEM_ICONS = {
  gold:       '🪙',
  potion:     '🧪',
  sword:      '⚔️',
  armor:      '🛡️',
  key:        '🗝️',
  food:       '🍖',
  rope:       '🪢',
  arrows:     '🏹',
  torch:      '🔦',
  rare_gem:   '💎',
  leg_weapon: '⚡',
  empty:      '—',
};

export function lootLine(entry) {
  const icon = ITEM_ICONS[entry.item] ?? '•';
  if (entry.item === 'empty') return `${icon} (empty)`;
  return `${icon} ${entry.label}${entry.qty > 1 ? ` ×${entry.qty}` : ''}`;
}
