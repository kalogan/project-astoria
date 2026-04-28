/**
 * sewersDungeon.js
 *
 * Static zone data for the Sewers dungeon — a four-room linear dungeon
 * accessible from the Cameron Dungeon Entrance.
 *
 * Zone progression:
 *   sewers_entry → sewers_room_1 → sewers_room_2 → sewers_boss
 *
 * No game systems are initialised here; this file is pure content data.
 */

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

/** Build an H×W tile grid by calling fn(row, col) for every cell. */
function _grid(W, H, fn) {
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => fn(r, c))
  );
}

/** Fill a rectangular region of a mutable grid with value v (inclusive bounds). */
function _fill(g, r1, c1, r2, c2, v) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++)
      g[r][c] = v;
}

// ---------------------------------------------------------------------------
// Zone 1 — SEWERS_ENTRY
// ---------------------------------------------------------------------------

/**
 * SEWERS_ENTRY — id: 'sewers_entry', 22×18
 *
 * Entry chamber. Two wall columns provide light cover. Two melee guards
 * stand watch. North exit returns to the Cameron Dungeon Entrance; south
 * corridor leads deeper into the sewers.
 *
 * offsetX = 10.5, offsetZ = 8.5
 *
 * Build order:
 *   1. All cells = 2 (wall)
 *   2. Interior floor: rows 1–16, cols 1–20 = 1
 *   3. North exit: rows 0–2, cols 9–12 = 1
 *   4. South corridor: rows 15–17, cols 9–12 = 1
 *   5. Left wall columns: rows 5–9, cols 3–4 = 2
 *   6. Right wall columns: rows 5–9, cols 17–18 = 2
 */
function _buildEntryTiles() {
  const W = 22, H = 18;
  const g = _grid(W, H, () => 2);
  _fill(g,  1,  1, 16, 20, 1); // interior floor
  _fill(g,  0,  9,  2, 12, 1); // north exit
  _fill(g, 15,  9, 17, 12, 1); // south corridor
  _fill(g,  5,  3,  9,  4, 2); // left columns
  _fill(g,  5, 17,  9, 18, 2); // right columns
  return g;
}

export const SEWERS_ENTRY = {
  id: 'sewers_entry',
  config: { width: 22, height: 18, seed: 0x5E0001 },
  playerStart: { x: 0, z: -7 },
  tiles: _buildEntryTiles(),
  entities: [
    // world(0, −7): col = 10.5 ≈ 11, row = 1.5 ≈ 2 — near north corridor
    { id: 'se_portal_north', type: 'portal', position: { x:  0, y: -7 } },
    // world(0,  7): col = 10.5 ≈ 11, row = 15.5 ≈ 16 — near south corridor
    { id: 'se_portal_south', type: 'portal', position: { x:  0, y:  7 } },
    { id: 'se_e1',           type: 'enemy',  position: { x: -4, y:  0 } },
    { id: 'se_e2',           type: 'enemy',  position: { x:  4, y:  0 } },
  ],
  systems: {
    enemies: [
      { entityId: 'se_e1', type: 'melee', hp: 90, speed: 2.3, attackDamage: 11, color: 0x334d33, xpValue: 12 },
      { entityId: 'se_e2', type: 'melee', hp: 90, speed: 2.3, attackDamage: 11, color: 0x334d33, xpValue: 12 },
    ],
    portals: [
      {
        entityId:   'se_portal_north',
        targetZone: 'cameron_dungeon_entrance',
        radius:     2,
        spawnX:     0,
        spawnZ:     4,
      },
      {
        entityId:   'se_portal_south',
        targetZone: 'sewers_room_1',
        radius:     2,
        spawnX:     0,
        spawnZ:     -9,
      },
    ],
    quests: [],
  },
  encounters: [],
  spawnPoints: [],
};

// ---------------------------------------------------------------------------
// Zone 2 — SEWERS_ROOM_1
// ---------------------------------------------------------------------------

/**
 * SEWERS_ROOM_1 — id: 'sewers_room_1', 26×22
 *
 * Second sewer chamber. Tall pillars flank the entrance side; rubble blocks
 * obstruct the south half. Four melee enemies patrol the space.
 *
 * offsetX = 12.5, offsetZ = 10.5
 *
 * Build order:
 *   1. All cells = 2
 *   2. Interior floor: rows 1–20, cols 1–24 = 1
 *   3. North corridor: rows 0–2, cols 11–14 = 1
 *   4. South corridor: rows 19–21, cols 11–14 = 1
 *   5. Left pillars: rows 5–8, cols 4–6 = 2
 *   6. Right pillars: rows 5–8, cols 19–21 = 2
 *   7. Left rubble: rows 13–15, cols 8–11 = 2
 *   8. Right rubble: rows 13–15, cols 14–17 = 2
 */
function _buildRoom1Tiles() {
  const W = 26, H = 22;
  const g = _grid(W, H, () => 2);
  _fill(g,  1,  1, 20, 24, 1); // interior floor
  _fill(g,  0, 11,  2, 14, 1); // north corridor
  _fill(g, 19, 11, 21, 14, 1); // south corridor
  _fill(g,  5,  4,  8,  6, 2); // left pillars
  _fill(g,  5, 19,  8, 21, 2); // right pillars
  _fill(g, 13,  8, 15, 11, 2); // left rubble
  _fill(g, 13, 14, 15, 17, 2); // right rubble
  return g;
}

export const SEWERS_ROOM_1 = {
  id: 'sewers_room_1',
  config: { width: 26, height: 22, seed: 0x5E0002 },
  playerStart: { x: 0, z: -8 },
  tiles: _buildRoom1Tiles(),
  entities: [
    { id: 'sr1_portal_north', type: 'portal', position: { x:  0, y: -9 } },
    { id: 'sr1_portal_south', type: 'portal', position: { x:  0, y:  9 } },
    { id: 'sr1_e1',           type: 'enemy',  position: { x: -6, y: -4 } },
    { id: 'sr1_e2',           type: 'enemy',  position: { x:  6, y: -4 } },
    { id: 'sr1_e3',           type: 'enemy',  position: { x: -5, y:  3 } },
    { id: 'sr1_e4',           type: 'enemy',  position: { x:  5, y:  3 } },
  ],
  systems: {
    enemies: [
      { entityId: 'sr1_e1', type: 'melee', hp: 100, speed: 2.3, attackDamage: 12, color: 0x334d33, xpValue: 14 },
      { entityId: 'sr1_e2', type: 'melee', hp: 100, speed: 2.3, attackDamage: 12, color: 0x334d33, xpValue: 14 },
      { entityId: 'sr1_e3', type: 'melee', hp: 100, speed: 2.3, attackDamage: 12, color: 0x334d33, xpValue: 14 },
      { entityId: 'sr1_e4', type: 'melee', hp: 100, speed: 2.3, attackDamage: 12, color: 0x334d33, xpValue: 14 },
    ],
    portals: [
      {
        entityId:   'sr1_portal_north',
        targetZone: 'sewers_entry',
        radius:     2,
        spawnX:     0,
        spawnZ:     6,
      },
      {
        entityId:   'sr1_portal_south',
        targetZone: 'sewers_room_2',
        radius:     2,
        spawnX:     0,
        spawnZ:     -10,
      },
    ],
    quests: [],
  },
  encounters: [],
  spawnPoints: [],
};

// ---------------------------------------------------------------------------
// Zone 3 — SEWERS_ROOM_2
// ---------------------------------------------------------------------------

/**
 * SEWERS_ROOM_2 — id: 'sewers_room_2', 30×24
 *
 * Deeper, more dangerous chamber. Mixed roster: melee flankers plus ranged
 * sewer archers. A wave encounter fires when the player enters the centre.
 *
 * offsetX = 14.5, offsetZ = 11.5
 *
 * Build order:
 *   1. All cells = 2
 *   2. Interior floor: rows 1–22, cols 1–28 = 1
 *   3. North corridor: rows 0–2, cols 13–16 = 1
 *   4. South corridor: rows 21–23, cols 13–16 = 1
 *   5. NW obstacle: rows 6–9, cols 5–9 = 2
 *   6. NE obstacle: rows 6–9, cols 20–24 = 2
 *   7. Mid-left obstacle: rows 13–16, cols 10–14 = 2
 *   8. Mid-right obstacle: rows 13–16, cols 15–19 = 2
 */
function _buildRoom2Tiles() {
  const W = 30, H = 24;
  const g = _grid(W, H, () => 2);
  _fill(g,  1,  1, 22, 28, 1); // interior floor
  _fill(g,  0, 13,  2, 16, 1); // north corridor
  _fill(g, 21, 13, 23, 16, 1); // south corridor
  _fill(g,  6,  5,  9,  9, 2); // NW obstacle
  _fill(g,  6, 20,  9, 24, 2); // NE obstacle
  _fill(g, 13, 10, 16, 14, 2); // mid-left obstacle
  _fill(g, 13, 15, 16, 19, 2); // mid-right obstacle
  return g;
}

export const SEWERS_ROOM_2 = {
  id: 'sewers_room_2',
  config: { width: 30, height: 24, seed: 0x5E0003 },
  playerStart: { x: 0, z: -9 },
  tiles: _buildRoom2Tiles(),
  entities: [
    { id: 'sr2_portal_north', type: 'portal', position: { x:  0, y: -10 } },
    { id: 'sr2_portal_south', type: 'portal', position: { x:  0, y:  10 } },
    { id: 'sr2_e1',           type: 'enemy',  position: { x: -8, y:  -6 } },
    { id: 'sr2_e2',           type: 'enemy',  position: { x:  8, y:  -6 } },
    { id: 'sr2_e3',           type: 'enemy',  position: { x: -6, y:   0 } },
    { id: 'sr2_e4',           type: 'enemy',  position: { x:  6, y:   0 } },
    { id: 'sr2_e5',           type: 'enemy',  position: { x: -3, y:   7 } },
    { id: 'sr2_e6',           type: 'enemy',  position: { x:  3, y:   7 } },
  ],
  systems: {
    enemies: [
      { entityId: 'sr2_e1', type: 'melee',  hp: 110, speed: 2.4, attackDamage: 13, color: 0x334d33, xpValue: 15 },
      { entityId: 'sr2_e2', type: 'melee',  hp: 110, speed: 2.4, attackDamage: 13, color: 0x334d33, xpValue: 15 },
      { entityId: 'sr2_e3', type: 'ranged', hp:  85, speed: 1.9, attackDamage: 16, color: 0x556b55, xpValue: 18 },
      { entityId: 'sr2_e4', type: 'ranged', hp:  85, speed: 1.9, attackDamage: 16, color: 0x556b55, xpValue: 18 },
      { entityId: 'sr2_e5', type: 'melee',  hp: 110, speed: 2.4, attackDamage: 13, color: 0x334d33, xpValue: 15 },
      { entityId: 'sr2_e6', type: 'melee',  hp: 110, speed: 2.4, attackDamage: 13, color: 0x334d33, xpValue: 15 },
    ],
    portals: [
      {
        entityId:   'sr2_portal_north',
        targetZone: 'sewers_room_1',
        radius:     2,
        spawnX:     0,
        spawnZ:     8,
      },
      {
        entityId:   'sr2_portal_south',
        targetZone: 'sewers_boss',
        radius:     2,
        spawnX:     0,
        spawnZ:     -10,
      },
    ],
    quests: [],
  },
  encounters: [
    {
      id:      'sr2_wave_1',
      type:    'wave',
      trigger: { type: 'area', position: { x: 0, z: 0 }, radius: 5 },
      waves: [
        {
          enemies: [
            { type: 'melee',  count: 2, hp: 110, speed: 2.5, attackDamage: 13, color: 0x334d33, xpValue: 15 },
            { type: 'ranged', count: 1, hp:  85, speed: 1.9, attackDamage: 16, color: 0x556b55, xpValue: 18 },
          ],
          delay: 0.5,
        },
      ],
      conditions: { completeOn: 'all_enemies_dead' },
      reward: { xp: 40, gold: 25 },
    },
  ],
  spawnPoints: [],
};

// ---------------------------------------------------------------------------
// Zone 4 — SEWERS_BOSS
// ---------------------------------------------------------------------------

/**
 * SEWERS_BOSS — id: 'sewers_boss', 26×24
 *
 * Open boss arena. Four corner pillars lend grandeur without blocking movement.
 * The south wall is sealed — completion is handled externally by the dungeon
 * manager. A boss encounter fires when the player crosses the threshold.
 *
 * offsetX = 12.5, offsetZ = 11.5
 *
 * Build order:
 *   1. All cells = 2
 *   2. Interior (open arena): rows 1–22, cols 1–24 = 1
 *   3. North corridor: rows 0–2, cols 11–14 = 1
 *   4. Corner pillars (four blocks) = 2
 *   5. South wall: rows 22–23 = 2 (re-seal — no south exit)
 */
function _buildBossTiles() {
  const W = 26, H = 24;
  const g = _grid(W, H, () => 2);
  _fill(g,  1,  1, 22, 24, 1); // open arena floor
  _fill(g,  0, 11,  2, 14, 1); // north corridor
  _fill(g,  3,  3,  5,  5, 2); // NW corner pillar
  _fill(g,  3, 20,  5, 22, 2); // NE corner pillar
  _fill(g, 18,  3, 20,  5, 2); // SW corner pillar
  _fill(g, 18, 20, 20, 22, 2); // SE corner pillar
  _fill(g, 22,  0, 23, 25, 2); // south wall (sealed)
  return g;
}

export const SEWERS_BOSS = {
  id: 'sewers_boss',
  config: { width: 26, height: 24, seed: 0x5E0004 },
  playerStart: { x: 0, z: -9 },
  tiles: _buildBossTiles(),
  entities: [
    { id: 'sb_portal_north', type: 'portal', position: { x:  0, y: -10 } },
    { id: 'sb_boss',         type: 'enemy',  position: { x:  0, y:   3 } },
    { id: 'sb_guard1',       type: 'enemy',  position: { x: -4, y:   2 } },
    { id: 'sb_guard2',       type: 'enemy',  position: { x:  4, y:   2 } },
  ],
  systems: {
    enemies: [
      { entityId: 'sb_boss',   type: 'tank',  hp: 450, speed: 1.4, attackDamage: 28, color: 0x990000, xpValue: 120 },
      { entityId: 'sb_guard1', type: 'melee', hp: 120, speed: 2.6, attackDamage: 14, color: 0x4d1a1a, xpValue:  18 },
      { entityId: 'sb_guard2', type: 'melee', hp: 120, speed: 2.6, attackDamage: 14, color: 0x4d1a1a, xpValue:  18 },
    ],
    portals: [
      {
        entityId:   'sb_portal_north',
        targetZone: 'sewers_room_2',
        radius:     2,
        spawnX:     0,
        spawnZ:     9,
      },
    ],
    quests: [],
  },
  encounters: [
    {
      id:      'sb_boss_encounter',
      type:    'boss',
      trigger: { type: 'area', position: { x: 0, z: 0 }, radius: 6 },
      waves: [
        {
          enemies: [
            { type: 'tank',  count: 1, hp: 450, speed: 1.4, attackDamage: 28, color: 0x990000, xpValue: 120 },
            { type: 'melee', count: 2, hp: 120, speed: 2.6, attackDamage: 14, color: 0x4d1a1a, xpValue:  18 },
          ],
          delay: 1.0,
        },
      ],
      conditions: { completeOn: 'all_enemies_dead' },
      reward: { xp: 200, gold: 120 },
    },
  ],
  spawnPoints: [],
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SEWER_ZONES = [
  SEWERS_ENTRY,
  SEWERS_ROOM_1,
  SEWERS_ROOM_2,
  SEWERS_BOSS,
];

/**
 * Register all Sewer zones with the provided zoneManager so they are
 * discoverable during zone transitions.
 *
 * @param {{ _generatedZones: Map<string, object> }} zoneManager
 */
export function registerSewerZones(zoneManager) {
  for (const z of SEWER_ZONES) {
    zoneManager._generatedZones.set(z.id, z);
  }
}
