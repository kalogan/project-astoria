/**
 * cameronZone.js
 *
 * Static zone data for the Cameron area — one large continuous map containing
 * the spawn courtyard, open walking space, and training grounds, with a single
 * north exit to the wilderness.
 *
 * Zone progression:
 *   Cameron (unified) → cameron_wilderness → cameron_dungeon_entrance
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
// Zone 1 — CAMERON (unified, organic path-first layout)
// ---------------------------------------------------------------------------

/**
 * CAMERON — id: 'Cameron', 64×56
 *
 * Path-first organic layout. Main path S-curves from spawn (south-center)
 * west through the town cluster, then curves back east into training grounds,
 * ending at a cave-mouth north exit. Buildings cluster on the west side in
 * varied sizes. East side is open meadow. NOT symmetric, NOT grid-aligned.
 *
 * offsetX = (64-1)/2 = 31.5   offsetZ = (56-1)/2 = 27.5
 * World → grid:  col = x + 31.5,  row = z + 27.5
 *
 * Wall regions (world coords, for prop/enemy placement reference):
 *   Bldg 1 Merchant Hall:  x ∈ [-27.5, -17.5],  z ∈ [ -0.5,  7.5]
 *   Bldg 2 Armory:         x ∈ [-19.5, -10.5],  z ∈ [ -4.5,  2.5]
 *   Bldg 3 Small House:    x ∈ [-17.5,  -9.5],  z ∈ [  3.5,  9.5]
 *   Bldg 4 Tavern:         x ∈ [-26.5, -16.5],  z ∈ [  9.5, 18.5]
 *   Bldg 5 Smithy:         x ∈ [-14.5,  -6.5],  z ∈ [ 10.5, 17.5]
 *   Bldg 6 East Outpost:   x ∈ [ 12.5,  21.5],  z ∈ [  3.5,  9.5]
 *   Training NW rock:      x ∈ [-21.5, -14.5],  z ∈ [-17.5, -13.5]
 *   Training NE rock:      x ∈ [ 12.5,  19.5],  z ∈ [-19.5, -15.5]
 *   Training center-W:     x ∈ [-13.5,  -7.5],  z ∈ [-11.5,  -7.5]
 *   Training center-E:     x ∈ [  4.5,  11.5],  z ∈ [-13.5,  -7.5]
 *   Training center-N:     x ∈ [ -1.5,   5.5],  z ∈ [-19.5, -15.5]
 *   Cave left jaw:         x ∈ [-31.5,  -2.5],  z ∈ [-27.5, -22.5]
 *   Cave right jaw:        x ∈ [  4.5,  12.5],  z ∈ [-27.5, -22.5]
 *
 * Build order:
 *   1. All cells = 2 (wall)
 *   2. Interior floor:    rows  1–54, cols  1–62 = 1
 *   3. Worn path (S-curve, each segment overlaps ~40% with adjacent):
 *      spawn stub → curves west → town junction → back east → training → cave
 *      + east branch from junction toward meadow/outpost
 *      + building-frontage wear patches
 *   4. Buildings (exterior wall, interior floor, entrance gap)
 *   5. Training obstacles (5 blocks, varied sizes, NOT symmetric)
 *   6. Cave mouth jaws + north exit corridor
 */
function _buildCameronTiles() {
  const W = 64, H = 56;
  const g = _grid(W, H, () => 2);

  // ── Base: full interior walkable ─────────────────────────────────────
  _fill(g,  1,  1, 54, 62, 1);

  // ── Worn path — S-curve meander ──────────────────────────────────────
  // Path shifts WEST as player walks north through town, then curves back
  // EAST into the training grounds.  Each fill shifts col centre ±3-4.
  _fill(g, 46, 28, 54, 38, 3);   // spawn stub (south, center-right)
  _fill(g, 40, 24, 48, 34, 3);   // curves west (−4)
  _fill(g, 34, 20, 42, 30, 3);   // continues west (−4)
  _fill(g, 26, 17, 36, 29, 3);   // town junction — widens (+2 each side)
  _fill(g, 22, 18, 28, 28, 3);   // town center north, narrows
  _fill(g, 16, 20, 24, 30, 3);   // past town, curves back east (+2)
  _fill(g, 10, 23, 18, 33, 3);   // training approach (+3)
  _fill(g,  4, 26, 12, 36, 3);   // training grounds (+3)

  // East branch — splits from junction, heads to east meadow + outpost
  _fill(g, 28, 29, 36, 52, 3);   // east branch (wide worn)
  _fill(g, 34, 44, 44, 58, 3);   // south-east meadow extension

  // Building-frontage wear (radiates out from entrances)
  _fill(g, 34,  4, 40, 14, 3);   // south face of Merchant Hall
  _fill(g, 40,  6, 48, 18, 3);   // Tavern + Smithy frontage

  // ── Town cluster — west side, ASYMMETRIC building sizes ──────────────
  // Bldg 1: Merchant Hall — largest (9r × 11c exterior)
  _fill(g, 27,  4, 35, 14, 2);
  _fill(g, 28,  5, 34, 13, 1);   // interior
  _fill(g, 35,  7, 35, 10, 1);   // south entrance

  // Bldg 2: Armory — medium (8r × 10c), nudged east + north of Hall
  _fill(g, 23, 12, 30, 21, 2);
  _fill(g, 24, 13, 29, 20, 1);   // interior
  _fill(g, 30, 14, 30, 18, 1);   // south entrance

  // Bldg 3: Small house — compact (7r × 9c), SE of cluster
  _fill(g, 31, 14, 37, 22, 2);
  _fill(g, 32, 15, 36, 21, 1);   // interior
  _fill(g, 31, 16, 31, 19, 1);   // north entrance

  // Bldg 4: Tavern — large south (10r × 11c)
  _fill(g, 37,  5, 46, 15, 2);
  _fill(g, 38,  6, 45, 14, 1);   // interior
  _fill(g, 37,  8, 37, 11, 1);   // north entrance

  // Bldg 5: Smithy — medium south-east (8r × 9c)
  _fill(g, 38, 17, 45, 25, 2);
  _fill(g, 39, 18, 44, 24, 1);   // interior
  _fill(g, 38, 19, 38, 22, 1);   // north entrance

  // Bldg 6: East outpost — isolated far east (7r × 10c)
  _fill(g, 31, 44, 37, 53, 2);
  _fill(g, 32, 45, 36, 52, 1);   // interior
  _fill(g, 37, 46, 37, 50, 1);   // south entrance

  // ── Training obstacles — scattered, ASYMMETRIC ────────────────────────
  _fill(g, 10, 10, 14, 17, 2);   // NW rock (wider)
  _fill(g,  8, 44, 12, 51, 2);   // NE rock (shorter)
  _fill(g, 16, 18, 20, 24, 2);   // center-W rock
  _fill(g, 14, 36, 20, 43, 2);   // center-E rock (taller)
  _fill(g,  8, 30, 12, 37, 2);   // center-north rock (forces path detour)

  // ── Cave mouth — flanking jaws frame dramatic north exit ─────────────
  _fill(g,  0, 22,  5, 29, 2);   // left jaw
  _fill(g,  0, 36,  5, 44, 2);   // right jaw
  _fill(g,  3, 25,  6, 28, 3);   // left cave floor (worn dark)
  _fill(g,  3, 37,  6, 40, 3);   // right cave floor

  // North exit corridor (punches through top border, between the jaws)
  _fill(g,  0, 30,  3, 35, 1);

  return g;
}

export const CAMERON = {
  id:          'Cameron',
  config:      { width: 64, height: 56, seed: 0xCA5E02 },
  playerStart: { x: 0, z: 16 },  // spawn courtyard, south-center

  tiles: _buildCameronTiles(),

  // ── Hand-authored props ──────────────────────────────────────────────────
  // y-offsets: barrel=0.46  crate=0.42  lamp=0.80  cart=0.20  scaffolding=0.20
  // offsetX=31.5, offsetZ=27.5 — col = x+31.5, row = z+27.5
  // All positions verified clear of wall regions above.
  props: [
    // ── Path-side cluster — junction east of buildings, on road ─────────
    { type: 'barrel',      color: 0x6b4a1e, x:  -7, y: 0.46, z:  4              },
    { type: 'barrel',      color: 0x7a5522, x:  -6, y: 0.46, z:  5              },
    { type: 'crate',       color: 0x8B6914, x:  -5, y: 0.42, z:  3, rotY:  0.4  },
    { type: 'crate',       color: 0x9b7a3a, x:  -4, y: 0.42, z:  4, rotY: -0.5  },

    // ── South of town cluster — outside Tavern + Smithy south faces ──────
    // z ≥ 19 is south of all buildings (Tavern south face at z=18.5)
    { type: 'cart',        color: 0x8B6914, x: -16, y: 0.20, z: 19, rotY:  0.3  },
    { type: 'barrel',      color: 0x6b4a1e, x: -17, y: 0.46, z: 20              },
    { type: 'barrel',      color: 0x7a5522, x: -15, y: 0.46, z: 20              },

    // ── Spawn courtyard ───────────────────────────────────────────────────
    { type: 'barrel',      color: 0x6b4a1e, x:  -5, y: 0.46, z: 14              },
    { type: 'barrel',      color: 0x7a5522, x:   5, y: 0.46, z: 15              },
    { type: 'crate',       color: 0x8B6914, x:   6, y: 0.42, z: 13, rotY:  0.6  },
    { type: 'barrel',      color: 0x6b4a1e, x:  -6, y: 0.46, z: 20              },
    { type: 'crate',       color: 0x9b7a3a, x:  -7, y: 0.42, z: 21, rotY:  0.7  },

    // ── East meadow / outpost ─────────────────────────────────────────────
    { type: 'barrel',      color: 0x6b4a1e, x:  22, y: 0.46, z:  7              },
    { type: 'barrel',      color: 0x7a5522, x:  23, y: 0.46, z:  8              },
    { type: 'crate',       color: 0x8B6914, x:  24, y: 0.42, z:  6, rotY:  0.3  },

    // ── Lamps — positioned along path and near buildings ──────────────────
    { type: 'lamp',        color: 0x555566, x:  -9, y: 0.80, z:  6              },
    { type: 'lamp',        color: 0x555566, x:   8, y: 0.80, z:  6              },
    { type: 'lamp',        color: 0x555566, x:   0, y: 0.80, z: -8              },
    { type: 'lamp',        color: 0x555566, x:   0, y: 0.80, z: 18              },

    // ── Training area ─────────────────────────────────────────────────────
    { type: 'barrel',      color: 0x6b4a1e, x: -26, y: 0.46, z: -19             },
    { type: 'barrel',      color: 0x6b4a1e, x:  22, y: 0.46, z: -18             },
    { type: 'scaffolding', color: 0x7a5a3a, x: -26, y: 0.20, z: -17, rotY: 0.1  },
  ],

  // ── Entities ─────────────────────────────────────────────────────────────
  entities: [
    // Greeter NPC — east of road near spawn, faces north
    // col = 4+31.5 = 35.5, row = 14+27.5 = 41.5 → open floor ✓
    {
      id:       'cam_npc_greeter',
      type:     'npc',
      position: { x: 4, y: 14 },
      name:     'Greeter',
      color:    0xd4a96a,
      facing:   Math.PI,
    },
    // Training enemies — distributed around training obstacle blocks
    { id: 'cam_e1', type: 'enemy', position: { x: -26, y: -16 } },
    { id: 'cam_e2', type: 'enemy', position: { x: -14, y: -16 } },
    { id: 'cam_e3', type: 'enemy', position: { x:  20, y: -16 } },
    { id: 'cam_e4', type: 'enemy', position: { x:  13, y: -15 } },
    { id: 'cam_e5', type: 'enemy', position: { x: -16, y:  -6 } },
    { id: 'cam_e6', type: 'enemy', position: { x:  -5, y:  -5 } },
    { id: 'cam_e7', type: 'enemy', position: { x:  -8, y: -20 } },
    { id: 'cam_e8', type: 'enemy', position: { x:   3, y:  -4 } },
    // North exit — in corridor between cave jaws
    // col = 0+31.5 = 31.5, row = -26+27.5 = 1.5 → corridor tile ✓
    { id: 'cam_portal_north', type: 'portal', position: { x: 0, y: -26 } },
  ],

  systems: {
    enemies: [
      { entityId: 'cam_e1', type: 'melee', hp:  60, speed: 2.0, attackDamage:  8, color: 0x8B4513, xpValue:  8 },
      { entityId: 'cam_e2', type: 'melee', hp:  60, speed: 2.0, attackDamage:  8, color: 0x8B4513, xpValue:  8 },
      { entityId: 'cam_e3', type: 'melee', hp:  60, speed: 2.0, attackDamage:  8, color: 0x8B4513, xpValue:  8 },
      { entityId: 'cam_e4', type: 'melee', hp:  60, speed: 2.0, attackDamage:  8, color: 0x8B4513, xpValue:  8 },
      { entityId: 'cam_e5', type: 'melee', hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
      { entityId: 'cam_e6', type: 'melee', hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
      { entityId: 'cam_e7', type: 'melee', hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
      { entityId: 'cam_e8', type: 'melee', hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
    ],
    portals: [
      {
        entityId:   'cam_portal_north',
        targetZone: 'cameron_wilderness',
        radius:     2,
        spawnX:     0,
        spawnZ:     -13,
      },
    ],
    quests: [],
  },
  // ── Room definitions ─────────────────────────────────────────────────────
  // minRow/maxRow/minCol/maxCol are tile-space bounds of each building's full
  // exterior wall block.  OcclusionSystem shrinks these 1 tile inward to get
  // the player-detection interior box, and tileRenderer uses them to tag wall
  // meshes so they can be faded independently when the player enters.
  //
  // (W=64, H=56 → offsetX=31.5, offsetZ=27.5)
  rooms: [
    { id: 'merchant_hall', minRow: 27, maxRow: 35, minCol:  4, maxCol: 14 },
    { id: 'armory',        minRow: 23, maxRow: 30, minCol: 12, maxCol: 21 },
    { id: 'small_house',   minRow: 31, maxRow: 37, minCol: 14, maxCol: 22 },
    { id: 'tavern',        minRow: 37, maxRow: 46, minCol:  5, maxCol: 15 },
    { id: 'smithy',        minRow: 38, maxRow: 45, minCol: 17, maxCol: 25 },
    { id: 'east_outpost',  minRow: 31, maxRow: 37, minCol: 44, maxCol: 53 },
  ],

  encounters:  [],
  spawnPoints: [],
};

// ---------------------------------------------------------------------------
// Zone 3 — CAMERON_WILDERNESS
// ---------------------------------------------------------------------------

/**
 * CAMERON_WILDERNESS — id: 'cameron_wilderness', 36×32
 *
 * Darker, denser outdoor zone. Mixed enemy roster (melee, ranged, one tank)
 * and a triggered ambush encounter at the centre clearing. The east exit leads
 * to the dungeon entrance.
 *
 * offsetX = 17.5, offsetZ = 15.5
 *
 * Build order:
 *   1. All cells = 2
 *   2. Interior floor: rows 1–30, cols 1–34 = 1
 *   3. North exit: rows 0–2, cols 15–20 = 1
 *   4. East exit:  rows 13–18, cols 34–35 = 1
 *   5–12. Eight dense obstacle blocks = 2
 */
function _buildWildernessTiles() {
  const W = 36, H = 32;
  const g = _grid(W, H, () => 2);
  _fill(g,  1,  1, 30, 34, 1); // interior floor
  _fill(g,  0, 15,  2, 20, 1); // north exit
  _fill(g, 13, 34, 18, 35, 1); // east exit
  _fill(g,  4,  4,  7,  9, 2);
  _fill(g,  4, 26,  7, 31, 2);
  _fill(g, 11,  6, 14, 10, 2);
  _fill(g, 11, 25, 14, 29, 2);
  _fill(g, 17, 11, 20, 16, 2);
  _fill(g, 17, 19, 20, 24, 2);
  _fill(g, 24,  5, 27,  8, 2);
  _fill(g, 24, 27, 27, 30, 2);
  return g;
}

export const CAMERON_WILDERNESS = {
  id: 'cameron_wilderness',
  config: { width: 36, height: 32, seed: 0xCAFE03 },
  playerStart: { x: 0, z: -13 },
  tiles: _buildWildernessTiles(),
  entities: [
    { id: 'wl_portal_north', type: 'portal', position: { x:   0, y: -14 } },
    { id: 'wl_portal_east',  type: 'portal', position: { x:  16, y:   0 } },
    { id: 'wl_e1',           type: 'enemy',  position: { x: -10, y:  -8 } },
    { id: 'wl_e2',           type: 'enemy',  position: { x:  -8, y:  -6 } },
    { id: 'wl_e3',           type: 'enemy',  position: { x:  10, y:  -8 } },
    { id: 'wl_e4',           type: 'enemy',  position: { x:   9, y:  -5 } },
    { id: 'wl_e5',           type: 'enemy',  position: { x:  -7, y:   3 } },
    { id: 'wl_e6',           type: 'enemy',  position: { x:   7, y:   3 } },
    { id: 'wl_e7',           type: 'enemy',  position: { x:  -3, y:  10 } },
    { id: 'wl_e8',           type: 'enemy',  position: { x:   3, y:  10 } },
  ],
  systems: {
    enemies: [
      { entityId: 'wl_e1', type: 'melee',  hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
      { entityId: 'wl_e2', type: 'melee',  hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
      { entityId: 'wl_e3', type: 'ranged', hp:  65, speed: 1.8, attackDamage: 13, color: 0x7a5c3a, xpValue: 13 },
      { entityId: 'wl_e4', type: 'ranged', hp:  65, speed: 1.8, attackDamage: 13, color: 0x7a5c3a, xpValue: 13 },
      { entityId: 'wl_e5', type: 'melee',  hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
      { entityId: 'wl_e6', type: 'tank',   hp: 130, speed: 1.6, attackDamage: 15, color: 0x3d2b1a, xpValue: 20 },
      { entityId: 'wl_e7', type: 'melee',  hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
      { entityId: 'wl_e8', type: 'melee',  hp:  80, speed: 2.2, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
    ],
    portals: [
      {
        entityId:   'wl_portal_north',
        targetZone: 'Cameron',
        radius:     2,
        spawnX:     0,
        spawnZ:     -20,  // returns player to training grounds, near north portal
      },
      {
        entityId:   'wl_portal_east',
        targetZone: 'cameron_dungeon_entrance',
        radius:     2,
        spawnX:     -8,
        spawnZ:     0,
      },
    ],
    quests: [],
  },
  encounters: [
    {
      id:      'wl_ambush_1',
      type:    'ambush',
      trigger: { type: 'area', position: { x: 0, z: 0 }, radius: 4 },
      waves: [
        {
          enemies: [
            { type: 'melee',  count: 2, hp: 80, speed: 2.5, attackDamage: 10, color: 0x5a3e28, xpValue: 10 },
            { type: 'ranged', count: 1, hp: 65, speed: 1.8, attackDamage: 13, color: 0x7a5c3a, xpValue: 13 },
          ],
          delay: 0,
        },
      ],
      conditions: { completeOn: 'all_enemies_dead' },
      reward: { xp: 30, gold: 15 },
    },
  ],
  spawnPoints: [],
};

// ---------------------------------------------------------------------------
// Zone 4 — CAMERON_DUNGEON_ENTRANCE
// ---------------------------------------------------------------------------

/**
 * CAMERON_DUNGEON_ENTRANCE — id: 'cameron_dungeon_entrance', 20×18
 *
 * Small, atmospheric antechamber. A ruined arch (two pillars + lintel) frames
 * the portal leading down into the sewers dungeon. No enemies — tension is
 * built through atmosphere and the weight of the portal.
 *
 * offsetX = 9.5, offsetZ = 8.5
 *
 * Arch construction:
 *   - Left pillar:  rows 5–11, cols 5–6  = 2
 *   - Right pillar: rows 5–11, cols 13–14 = 2
 *   - Lintel:       rows 5–6,  cols 5–14  = 2  (spans both pillars)
 *   - Interior:     rows 7–11, cols 7–12  = 1  (force passable after lintel)
 */
function _buildDungeonEntranceTiles() {
  const W = 20, H = 18;
  const g = _grid(W, H, () => 2);
  _fill(g,  1,  1, 16, 18, 1); // interior floor
  _fill(g,  0,  8,  2, 11, 1); // north exit
  _fill(g,  5,  5, 11,  6, 2); // left pillar
  _fill(g,  5, 13, 11, 14, 2); // right pillar
  _fill(g,  5,  5,  6, 14, 2); // lintel (top bar)
  _fill(g,  7,  7, 11, 12, 1); // passable arch interior
  return g;
}

export const CAMERON_DUNGEON_ENTRANCE = {
  id: 'cameron_dungeon_entrance',
  config: { width: 20, height: 18, seed: 0xCAFE04 },
  playerStart: { x: 0, z: -6 },
  tiles: _buildDungeonEntranceTiles(),
  entities: [
    { id: 'de_portal_north',   type: 'portal', position: { x: 0, y: -7 } },
    { id: 'de_portal_dungeon', type: 'portal', position: { x: 0, y:  5 } },
  ],
  systems: {
    enemies: [],
    portals: [
      {
        entityId:   'de_portal_north',
        targetZone: 'cameron_wilderness',
        radius:     2,
        spawnX:     15,
        spawnZ:     0,
      },
      {
        entityId:   'de_portal_dungeon',
        targetZone: 'sewers_entry',
        radius:     2,
        spawnX:     0,
        spawnZ:     -8,
      },
    ],
    quests: [],
  },
  encounters: [],
  spawnPoints: [],
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const CAMERON_ZONES = [
  CAMERON,
  CAMERON_WILDERNESS,
  CAMERON_DUNGEON_ENTRANCE,
];

/**
 * Register all Cameron zones with the provided zoneManager so they are
 * discoverable during zone transitions.
 *
 * @param {{ _generatedZones: Map<string, object> }} zoneManager
 */
export function registerCameronZones(zoneManager) {
  console.log('[Cameron] Builder running');
  for (const z of CAMERON_ZONES) {
    zoneManager._generatedZones.set(z.id, z);
    console.log(
      `[Cameron] Zone: ${z.id} | Props: ${z.props?.length ?? 0}` +
      ` | NPCs: ${z.entities.filter(e => e.type === 'npc').length}`,
    );
  }
}
