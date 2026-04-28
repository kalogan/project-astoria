// skellie4Zone.js — skeleton farming zone (40×36) + clan PvP arena (32×30).

function _grid(W, H, fn) {
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => fn(r, c))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone A: skellie4 — 40 wide × 36 tall
// offsetX = (40-1)/2 = 19.5   offsetZ = (36-1)/2 = 17.5
// world x = col − 19.5        world z = row − 17.5
// ─────────────────────────────────────────────────────────────────────────────
const SK4_W = 40;
const SK4_H = 36;

function sk4Tile(r, c) {
  // North exit: rows 0–2, cols 17–22 = floor  (connects to cameron_wilderness)
  if (r >= 0 && r <= 2 && c >= 17 && c <= 22) return 1;
  // South exit: rows 33–35, cols 17–22 = floor  (connects to clan_spawner_zone)
  if (r >= 33 && r <= 35 && c >= 17 && c <= 22) return 1;

  // Border walls
  if (r === 0 || r === SK4_H - 1 || c === 0 || c === SK4_W - 1) return 2;

  // Obstacle scatter — gravestone/ruin clusters
  if (r >= 5  && r <= 7  && c >= 4  && c <= 8)  return 2;
  if (r >= 5  && r <= 7  && c >= 31 && c <= 35) return 2;
  if (r >= 10 && r <= 13 && c >= 13 && c <= 19) return 2;
  if (r >= 10 && r <= 13 && c >= 21 && c <= 27) return 2;
  if (r >= 18 && r <= 21 && c >= 5  && c <= 10) return 2;
  if (r >= 18 && r <= 21 && c >= 29 && c <= 34) return 2;
  if (r >= 25 && r <= 27 && c >= 15 && c <= 24) return 2;

  return 1;
}

const sk4Tiles = _grid(SK4_W, SK4_H, sk4Tile);

export const SKELLIE4_ZONES = [
  // ── Zone A ──────────────────────────────────────────────────────────────────
  {
    id: 'skellie4',
    config: { width: SK4_W, height: SK4_H, seed: 0x54B10 },
    playerStart: { x: 0, z: 0 },
    tiles: sk4Tiles,
    entities: [
      // Portals
      // North portal: row ~0, col 19-20 → world (0, -17.5) ≈ (0, -16) fine; spec says spawnX=15, spawnZ=0
      { id: 'sk4_portal_north', type: 'portal', position: { x:  0, y: -16 } },
      // South portal: row ~35, col 19-20 → world z = 35-17.5 = 17.5 ≈ 15; spec spawnX=0, spawnZ=-13
      { id: 'sk4_portal_south', type: 'portal', position: { x:  0, y:  15 } },

      // Initial enemies
      { id: 'sk4_e1', type: 'enemy', position: { x: -10, y:  -8 } },
      { id: 'sk4_e2', type: 'enemy', position: { x:  10, y:  -8 } },
      { id: 'sk4_e3', type: 'enemy', position: { x:  -5, y:  -2 } },
      { id: 'sk4_e4', type: 'enemy', position: { x:   5, y:  -2 } },
      { id: 'sk4_e5', type: 'enemy', position: { x:   0, y:  -5 } },
      { id: 'sk4_e6', type: 'enemy', position: { x: -12, y:   5 } },
      { id: 'sk4_e7', type: 'enemy', position: { x:  12, y:   5 } },
      { id: 'sk4_e8', type: 'enemy', position: { x:   0, y:  10 } },
    ],
    systems: {
      portals: [
        {
          entityId:   'sk4_portal_north',
          targetZone: 'cameron_wilderness',
          radius:     2,
          spawnX:     15,
          spawnZ:     0,
        },
        {
          entityId:   'sk4_portal_south',
          targetZone: 'clan_spawner_zone',
          radius:     2,
          spawnX:     0,
          spawnZ:     -13,
        },
      ],
      enemies: [
        // skeleton_melee
        { entityId: 'sk4_e1', type: 'melee',  hp: 90,  speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
        { entityId: 'sk4_e2', type: 'melee',  hp: 90,  speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
        // skeleton_archer
        { entityId: 'sk4_e3', type: 'ranged', hp: 70,  speed: 2.0, attackDamage: 14, color: 0xc8b89a, xpValue: 14 },
        { entityId: 'sk4_e4', type: 'ranged', hp: 70,  speed: 2.0, attackDamage: 14, color: 0xc8b89a, xpValue: 14 },
        // skeleton_elite
        { entityId: 'sk4_e5', type: 'tank',   hp: 200, speed: 1.8, attackDamage: 18, color: 0x8b7355, xpValue: 30 },
        // extra melee
        { entityId: 'sk4_e6', type: 'melee',  hp: 90,  speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
        { entityId: 'sk4_e7', type: 'melee',  hp: 90,  speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
        { entityId: 'sk4_e8', type: 'melee',  hp: 90,  speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
      ],
      quests: [],
    },
    encounters: [],
    spawnPoints: [
      { id: 'sk4_sp1', x: -10, z: -5, interval: 6,  maxActive: 3, enemyType: 'melee',  hp: 90, speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
      { id: 'sk4_sp2', x:  10, z: -5, interval: 6,  maxActive: 3, enemyType: 'melee',  hp: 90, speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
      { id: 'sk4_sp3', x:   0, z:  2, interval: 8,  maxActive: 2, enemyType: 'ranged', hp: 70, speed: 2.0, attackDamage: 14, color: 0xc8b89a, xpValue: 14 },
      { id: 'sk4_sp4', x: -12, z:  8, interval: 10, maxActive: 2, enemyType: 'melee',  hp: 90, speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
      { id: 'sk4_sp5', x:  12, z:  8, interval: 10, maxActive: 2, enemyType: 'melee',  hp: 90, speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
    ],
  },

  // ── Zone B: clan_spawner_zone — 32 wide × 30 tall ───────────────────────────
  // offsetX = (32-1)/2 = 15.5   offsetZ = (30-1)/2 = 14.5
  // world x = col − 15.5        world z = row − 14.5
  (() => {
    const CSW = 32;
    const CSH = 30;

    function csTile(r, c) {
      // North exit: rows 0–1, cols 13–18 = floor  (connects to skellie4)
      if (r >= 0 && r <= 1 && c >= 13 && c <= 18) return 1;

      // Border walls (all edges)
      if (r === 0 || r === CSH - 1 || c === 0 || c === CSW - 1) return 2;

      // CHOKE CORRIDOR: rows 1–8 — only cols 13–18 are floor, rest = wall
      if (r >= 1 && r <= 8) {
        if (c >= 13 && c <= 18) return 1;
        return 2;
      }

      // ARENA BOUNDARY: row 29 all wall (already handled by border, belt-and-suspenders)
      if (r === 29) return 2;

      // ARENA: rows 9–28 = open floor
      return 1;
    }

    const csTiles = _grid(CSW, CSH, csTile);

    return {
      id: 'clan_spawner_zone',
      config: { width: CSW, height: CSH, seed: 0xC1A4A },
      playerStart: { x: 0, z: 0 },
      tiles: csTiles,
      entities: [
        // North portal: row ~0, col 15-16 → world z = 0 − 14.5 = −14.5 ≈ −13
        { id: 'cs_portal_north',   type: 'portal',          position: { x:  0, y: -13 } },
        // Central jewel spawner: world(0, 8) — spec says center of arena
        { id: 'clan_jewel_spawner', type: 'jewel_spawner',  position: { x:  0, y:   8 } },
      ],
      systems: {
        portals: [
          {
            entityId:   'cs_portal_north',
            targetZone: 'skellie4',
            radius:     2,
            spawnX:     0,
            spawnZ:     15,
          },
        ],
        enemies: [],
        quests:  [],
      },
      encounters: [],
      spawnPoints: [
        { id: 'arena_sp1', x: -8, z:  5, interval: 12, maxActive: 2, enemyType: 'melee', hp: 90,  speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
        { id: 'arena_sp2', x:  8, z:  5, interval: 12, maxActive: 2, enemyType: 'melee', hp: 90,  speed: 2.5, attackDamage: 12, color: 0xd4c5a9, xpValue: 12 },
        { id: 'arena_sp3', x:  0, z: 12, interval: 15, maxActive: 1, enemyType: 'tank',  hp: 150, speed: 1.5, attackDamage: 18, color: 0x8b7355, xpValue: 30 },
      ],
    };
  })(),
];

export function registerSkellie4Zones(zoneManager) {
  for (const zone of SKELLIE4_ZONES) {
    zoneManager._generatedZones.set(zone.id, zone);
  }
}
