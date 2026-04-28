// Aston Zombies II — ruined combat district, 36×32, persistent respawning enemies.

function _grid(W, H, buildFn) {
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => buildFn(r, c))
  );
}

const W = 36;
const H = 32;

function buildTile(r, c) {
  // Outer border
  if (r === 0 || r === H - 1 || c === 0 || c === W - 1) {
    // North exit: rows 0–2, cols 15–20 = floor
    if (r >= 0 && r <= 2 && c >= 15 && c <= 20) return 1;
    return 2;
  }

  // Rubble obstacles (solid wall blocks)
  if (r >= 5  && r <= 7  && c >= 5  && c <= 10) return 2;
  if (r >= 5  && r <= 7  && c >= 25 && c <= 30) return 2;
  if (r >= 10 && r <= 12 && c >= 14 && c <= 21) return 2;
  if (r >= 18 && r <= 20 && c >= 3  && c <= 8)  return 2;
  if (r >= 18 && r <= 20 && c >= 27 && c <= 32) return 2;
  if (r >= 23 && r <= 26 && c >= 13 && c <= 18) return 2;
  if (r >= 23 && r <= 26 && c >= 19 && c <= 22) return 2;

  return 1;
}

const tiles = _grid(W, H, buildTile);

// Enemy stat profiles
const ZOMBIE_BASIC = { hp: 70,  speed: 1.8, attackDamage: 8,  color: 0x2d5a27, xpValue: 8  };
const ZOMBIE_FAST  = { hp: 50,  speed: 3.5, attackDamage: 6,  color: 0x4a7a3a, xpValue: 10 };
const ZOMBIE_ELITE = { hp: 200, speed: 1.5, attackDamage: 15, color: 0x1a3a18, xpValue: 25 };

export const ZOMBIES_II_ZONE = {
  id: 'aston_zombies_ii',
  config: { width: W, height: H, seed: 0x2B1E5 },
  playerStart: { x: 0, z: 0 },
  tiles,
  entities: [
    // offsetX = (36-1)/2 = 17.5, offsetZ = (32-1)/2 = 15.5
    // world x = col − 17.5, world z = row − 15.5
    { id: 'zz_portal_north', type: 'portal', position: { x:   0, y: -14 } },
    { id: 'zz_e1',           type: 'enemy',  position: { x: -10, y:  -7 } },
    { id: 'zz_e2',           type: 'enemy',  position: { x:  -8, y:  -5 } },
    { id: 'zz_e3',           type: 'enemy',  position: { x:   8, y:  -7 } },
    { id: 'zz_e4',           type: 'enemy',  position: { x:  10, y:  -5 } },
    { id: 'zz_e5',           type: 'enemy',  position: { x:  -5, y:   2 } },
    { id: 'zz_e6',           type: 'enemy',  position: { x:   5, y:   2 } },
    { id: 'zz_e7',           type: 'enemy',  position: { x:   0, y:   5 } },
    { id: 'zz_e8',           type: 'enemy',  position: { x:  -9, y:   9 } },
    { id: 'zz_e9',           type: 'enemy',  position: { x:   9, y:   9 } },
    { id: 'zz_e10',          type: 'enemy',  position: { x:   0, y:  12 } },
  ],
  systems: {
    portals: [
      {
        entityId:   'zz_portal_north',
        targetZone: 'aston_core',
        radius:     2,
        spawnX:     0,
        spawnZ:     20,
      },
    ],
    enemies: [
      { entityId: 'zz_e1',  type: 'melee', ...ZOMBIE_BASIC },
      { entityId: 'zz_e2',  type: 'melee', ...ZOMBIE_BASIC },
      { entityId: 'zz_e3',  type: 'melee', ...ZOMBIE_BASIC },
      { entityId: 'zz_e4',  type: 'melee', ...ZOMBIE_BASIC },
      { entityId: 'zz_e5',  type: 'melee', ...ZOMBIE_FAST  },
      { entityId: 'zz_e6',  type: 'melee', ...ZOMBIE_FAST  },
      { entityId: 'zz_e7',  type: 'tank',  ...ZOMBIE_ELITE },
      { entityId: 'zz_e8',  type: 'melee', ...ZOMBIE_BASIC },
      { entityId: 'zz_e9',  type: 'melee', ...ZOMBIE_BASIC },
      { entityId: 'zz_e10', type: 'melee', ...ZOMBIE_BASIC },
    ],
  },
  encounters: [],
  spawnPoints: [
    { id: 'sp_1', x: -10, z: -5, interval: 8,  maxActive: 3, enemyType: 'melee', hp: 70, speed: 1.8, color: 0x2d5a27 },
    { id: 'sp_2', x:   8, z: -5, interval: 8,  maxActive: 3, enemyType: 'melee', hp: 70, speed: 1.8, color: 0x2d5a27 },
    { id: 'sp_3', x:   0, z:  8, interval: 6,  maxActive: 2, enemyType: 'melee', hp: 50, speed: 3.5, color: 0x4a7a3a },
    { id: 'sp_4', x:  -8, z: 10, interval: 10, maxActive: 2, enemyType: 'melee', hp: 70, speed: 1.8, color: 0x2d5a27 },
    { id: 'sp_5', x:   8, z: 10, interval: 10, maxActive: 2, enemyType: 'melee', hp: 70, speed: 1.8, color: 0x2d5a27 },
  ],
};

export function registerZombiesZones(zoneManager) {
  zoneManager._generatedZones.set(ZOMBIES_II_ZONE.id, ZOMBIES_II_ZONE);
}
