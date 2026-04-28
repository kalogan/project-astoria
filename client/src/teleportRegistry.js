// teleportRegistry.js — all available fast-travel destinations.

export const TELEPORT_DESTINATIONS = [
  { id: 'cameron',      name: 'Cameron',           zoneId: 'Cameron',                  unlocked: true,  spawnX: 0,   spawnZ: 12  },
  { id: 'training',     name: 'Training Grounds',  zoneId: 'Cameron',                  unlocked: true,  spawnX: 0,   spawnZ: -10 },
  { id: 'wilderness',   name: 'Outer Wilderness',  zoneId: 'cameron_wilderness',       unlocked: true,  spawnX: 0,   spawnZ: -13 },
  { id: 'dungeon_gate', name: 'Dungeon Gate',      zoneId: 'cameron_dungeon_entrance', unlocked: true,  spawnX: 0,   spawnZ: -6  },
  { id: 'sewers',       name: 'Sewers (Entry)',    zoneId: 'sewers_entry',             unlocked: false, spawnX: 0,   spawnZ: -7  },
  { id: 'skellie4',     name: 'Skeleton Grounds',  zoneId: 'skellie4',                 unlocked: true,  spawnX: 0,   spawnZ: -15 },
  { id: 'spawner',      name: 'Clan Spawner',      zoneId: 'clan_spawner_zone',        unlocked: true,  spawnX: 0,   spawnZ: -13 },
  { id: 'aston_core',   name: 'Aston Core',        zoneId: 'aston_core',              unlocked: true,  spawnX: 0,   spawnZ: 0   },
  { id: 'service',      name: 'Service District',  zoneId: 'aston_service_district',  unlocked: true,  spawnX: -13, spawnZ: 0   },
  { id: 'zombies_ii',   name: 'Zombies II',        zoneId: 'aston_zombies_ii',        unlocked: true,  spawnX: 0,   spawnZ: -14 },
  { id: 'pentagram',    name: 'Pentagram Pit',     zoneId: 'pentagram_pit',           unlocked: true,  spawnX: 0,   spawnZ: -10 },
];

export function getDestination(id) {
  return TELEPORT_DESTINATIONS.find(d => d.id === id) ?? null;
}

export function getUnlocked() {
  return TELEPORT_DESTINATIONS.filter(d => d.unlocked);
}

export function unlock(id) {
  const d = getDestination(id);
  if (d) d.unlocked = true;
}
