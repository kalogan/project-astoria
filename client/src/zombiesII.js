// Aston Zombies II — ruined combat district, 38×34, continuous zombie pressure.

function _makeGrid(W, H) {
  return Array.from({ length: H }, () => new Array(W).fill(2));
}

function _fill(g, r1, c1, r2, c2, v) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) g[r][c] = v;
}

const W = 38;
const H = 34;

// offsetX = (38-1)/2 = 18.5, offsetZ = (34-1)/2 = 16.5
// world_x = col − 18.5, world_z = row − 16.5

function buildTiles() {
  const g = _makeGrid(W, H);

  // 2. Interior floor: rows 1–32, cols 1–36
  _fill(g, 1, 1, 32, 36, 1);

  // 3. North choke/connection to Aston Core: rows 0–3, cols 16–21 = floor
  _fill(g, 0, 16, 3, 21, 1);

  // 4–10. Rubble blocks
  _fill(g,  5,  4,  8, 10, 2); // rubble 1
  _fill(g,  5, 27,  8, 33, 2); // rubble 2
  _fill(g, 13,  7, 16, 14, 2); // rubble 3
  _fill(g, 13, 23, 16, 30, 2); // rubble 4
  _fill(g, 20,  4, 23,  9, 2); // rubble 5
  _fill(g, 20, 28, 23, 33, 2); // rubble 6
  _fill(g, 26, 13, 29, 24, 2); // rubble 7

  // 11. South boundary: rows 32–33 = wall (already wall from _makeGrid, floor rows 1–32
  //     re-seal row 32 southern edge with wall via border row 33 which was never floored,
  //     and row 32 was floored above — leave row 33 as default wall from _makeGrid)
  _fill(g, 33, 0, 33, W - 1, 2);

  return g;
}

const tiles = buildTiles();

// Validate dimensions
if (tiles.length !== H) throw new Error(`zombiesII: tiles.length ${tiles.length} !== H ${H}`);
if (tiles[0].length !== W) throw new Error(`zombiesII: tiles[0].length ${tiles[0].length} !== W ${W}`);

export const ZOMBIES_II_ZONE = {
  id: 'aston_zombies_ii',
  config: { width: W, height: H, seed: 0x2B1E5 },
  playerStart: { x: 0, z: -14 },
  tiles,
  entities: [
    // offsetX=18.5, offsetZ=16.5 → world_x=col−18.5, world_z=row−16.5
    { id: 'zii_portal_north', type: 'portal', position: { x:   0, y: -15 } },
    { id: 'zii_e1',           type: 'enemy',  position: { x: -10, y:  -8 } },
    { id: 'zii_e2',           type: 'enemy',  position: { x:  10, y:  -8 } },
    { id: 'zii_e3',           type: 'enemy',  position: { x:  -6, y:   0 } },
    { id: 'zii_e4',           type: 'enemy',  position: { x:   6, y:   0 } },
    { id: 'zii_e5',           type: 'enemy',  position: { x:   0, y:  -4 } },
    { id: 'zii_e6',           type: 'enemy',  position: { x: -12, y:   5 } },
    { id: 'zii_e7',           type: 'enemy',  position: { x:  12, y:   5 } },
    { id: 'zii_e8',           type: 'enemy',  position: { x:  -4, y:  10 } },
    { id: 'zii_e9',           type: 'enemy',  position: { x:   4, y:  10 } },
    { id: 'zii_e10',          type: 'enemy',  position: { x:   0, y:  13 } },
  ],
  systems: {
    portals: [
      {
        entityId:   'zii_portal_north',
        targetZone: 'aston_core',
        radius:     2,
        spawnX:     -13,
        spawnZ:     8,
      },
    ],
    enemies: [
      // zombie_basic: hp:95, speed:1.8, attackDamage:11, color:0x4a6741, xpValue:10
      { entityId: 'zii_e1',  type: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
      { entityId: 'zii_e2',  type: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
      { entityId: 'zii_e3',  type: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
      { entityId: 'zii_e4',  type: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
      // zombie_fast: hp:70, speed:2.8, attackDamage:13, color:0x6b8f5e, xpValue:12
      { entityId: 'zii_e5',  type: 'melee', hp:  70, speed: 2.8, attackDamage: 13, color: 0x6b8f5e, xpValue: 12 },
      { entityId: 'zii_e6',  type: 'melee', hp:  70, speed: 2.8, attackDamage: 13, color: 0x6b8f5e, xpValue: 12 },
      { entityId: 'zii_e7',  type: 'melee', hp:  70, speed: 2.8, attackDamage: 13, color: 0x6b8f5e, xpValue: 12 },
      // zombie_elite: hp:200, speed:1.4, attackDamage:18, color:0x2d4a2a, xpValue:25
      { entityId: 'zii_e8',  type: 'tank',  hp: 200, speed: 1.4, attackDamage: 18, color: 0x2d4a2a, xpValue: 25 },
      { entityId: 'zii_e9',  type: 'tank',  hp: 200, speed: 1.4, attackDamage: 18, color: 0x2d4a2a, xpValue: 25 },
      // zombie_basic continued
      { entityId: 'zii_e10', type: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
    ],
  },
  encounters: [
    {
      id:      'zii_horde_1',
      type:    'wave',
      trigger: { type: 'area', position: { x: 0, z: 5 }, radius: 5 },
      waves: [
        {
          enemies: [
            { type: 'melee', count: 4, hp: 95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
          ],
          delay: 1.0,
        },
      ],
      conditions: { completeOn: 'all_enemies_dead' },
      reward:     { xp: 35, gold: 20 },
    },
  ],
  spawnPoints: [
    { id: 'zii_sp1', x: -10, z:  -5, interval:  8, maxActive: 3, enemyType: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
    { id: 'zii_sp2', x:  10, z:  -5, interval:  8, maxActive: 3, enemyType: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
    { id: 'zii_sp3', x:   0, z:   3, interval: 10, maxActive: 2, enemyType: 'melee', hp:  70, speed: 2.8, attackDamage: 13, color: 0x6b8f5e, xpValue: 12 },
    { id: 'zii_sp4', x: -12, z:  10, interval: 12, maxActive: 2, enemyType: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
    { id: 'zii_sp5', x:  12, z:  10, interval: 12, maxActive: 2, enemyType: 'melee', hp:  95, speed: 1.8, attackDamage: 11, color: 0x4a6741, xpValue: 10 },
  ],
};

export function registerZombiesZones(zoneManager) {
  zoneManager._generatedZones.set(ZOMBIES_II_ZONE.id, ZOMBIES_II_ZONE);
}
