// Aston Core — medieval city hub, 48×44, safe zone, no enemies.

function _makeGrid(W, H) {
  return Array.from({ length: H }, () => new Array(W).fill(2));
}

function _fill(g, r1, c1, r2, c2, v) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) g[r][c] = v;
}

const W = 48;
const H = 44;

// offsetX = (48-1)/2 = 23.5, offsetZ = (44-1)/2 = 21.5
// world_x = col − 23.5, world_z = row − 21.5

function buildTiles() {
  const g = _makeGrid(W, H);

  // 2. Full interior floor: rows 1–42, cols 1–46
  _fill(g, 1, 1, 42, 46, 1);

  // 3. Palace (north landmark): rows 2–12, cols 19–28 = wall
  _fill(g, 2, 19, 12, 28, 2);
  // Palace entrance gap: rows 11–12, cols 22–25 = floor
  _fill(g, 11, 22, 12, 25, 1);

  // 4. Shops cluster (east): rows 16–26, cols 37–45 = wall
  _fill(g, 16, 37, 26, 45, 2);
  // Shops door: rows 20–22, cols 37–38 = floor
  _fill(g, 20, 37, 22, 38, 1);

  // 5. Bank (west): rows 16–26, cols 2–10 = wall
  _fill(g, 16, 2, 26, 10, 2);
  // Bank door: rows 20–22, cols 9–10 = floor
  _fill(g, 20, 9, 22, 10, 1);

  // 6. Clan Master (south-east): rows 32–40, cols 35–44 = wall
  _fill(g, 32, 35, 40, 44, 2);
  // Clan door: rows 35–37, cols 35–36 = floor
  _fill(g, 35, 35, 37, 36, 1);

  // 7. Teleporter plaza: rows 33–42, cols 19–28 = floor (open area, already floor)
  _fill(g, 33, 19, 42, 28, 1);

  // 9. Main south gate: rows 42–43, cols 20–27 = floor (punch through bottom border)
  _fill(g, 42, 20, 43, 27, 1);

  // 10. Decorative wall posts along main paths
  g[13][23] = 2;
  g[14][23] = 2;
  g[13][24] = 2;
  g[14][24] = 2;
  g[28][23] = 2;
  g[29][23] = 2;
  g[28][24] = 2;
  g[29][24] = 2;

  return g;
}

const tiles = buildTiles();

// Validate dimensions
if (tiles.length !== H) throw new Error(`astonCore: tiles.length ${tiles.length} !== H ${H}`);
if (tiles[0].length !== W) throw new Error(`astonCore: tiles[0].length ${tiles[0].length} !== W ${W}`);

export const ASTON_CORE_ZONE = {
  id: 'aston_core',
  config: { width: W, height: H, seed: 0xA57C0 },
  playerStart: { x: 0, z: 0 },
  tiles,
  entities: [
    // offsetX=23.5, offsetZ=21.5 → world_x=col−23.5, world_z=row−21.5
    { id: 'ac_npc_palace_guard_l', type: 'npc',      position: { x: -2,  y: -10 } },
    { id: 'ac_npc_palace_guard_r', type: 'npc',      position: { x:  2,  y: -10 } },
    { id: 'ac_npc_shopkeeper',     type: 'npc',      position: { x: 13,  y:   0 } },
    { id: 'ac_npc_banker',         type: 'npc',      position: { x: -13, y:   0 } },
    { id: 'ac_npc_clan_master',    type: 'npc',      position: { x: 11,  y:  12 } },
    { id: 'ac_teleporter',         type: 'teleporter', position: { x:  0, y:  15 } },
    { id: 'ac_portal_south_gate',  type: 'portal',   position: { x:  0,  y:  20 } },
    { id: 'ac_portal_to_service',  type: 'portal',   position: { x: 13,  y:  -3 } },
    { id: 'ac_portal_to_zombies',  type: 'portal',   position: { x: -13, y:   8 } },
  ],
  systems: {
    enemies: [],
    portals: [
      {
        entityId:   'ac_portal_south_gate',
        targetZone: 'Cameron',
        radius:     2,
        spawnX:     0,
        spawnZ:     0,
      },
      {
        entityId:   'ac_portal_to_service',
        targetZone: 'aston_service_district',
        radius:     2,
        spawnX:     -13,
        spawnZ:     0,
      },
      {
        entityId:   'ac_portal_to_zombies',
        targetZone: 'aston_zombies_ii',
        radius:     2,
        spawnX:     10,
        spawnZ:     0,
      },
    ],
  },
  encounters:   [],
  spawnPoints:  [],
};

export function registerAstonZones(zoneManager) {
  zoneManager._generatedZones.set(ASTON_CORE_ZONE.id, ASTON_CORE_ZONE);
}
