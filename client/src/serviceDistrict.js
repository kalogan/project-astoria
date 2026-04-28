// Aston Service District — functional services hub, 36×30, safe zone, no enemies.

function _makeGrid(W, H) {
  return Array.from({ length: H }, () => new Array(W).fill(2));
}

function _fill(g, r1, c1, r2, c2, v) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) g[r][c] = v;
}

const W = 36;
const H = 30;

// offsetX = (36-1)/2 = 17.5, offsetZ = (30-1)/2 = 14.5
// world_x = col − 17.5, world_z = row − 14.5

function buildTiles() {
  const g = _makeGrid(W, H);

  // 2. Interior floor: rows 1–28, cols 1–34
  _fill(g, 1, 1, 28, 34, 1);

  // 4. SHOP building (north-east): rows 3–11, cols 22–32 = wall
  _fill(g, 3, 22, 11, 32, 2);
  // Shop entrance: rows 9–11, cols 22–23 = floor
  _fill(g, 9, 22, 11, 23, 1);

  // 5. BANK building (north-west): rows 3–11, cols 3–13 = wall
  _fill(g, 3, 3, 11, 13, 2);
  // Bank entrance: rows 9–11, cols 12–13 = floor
  _fill(g, 9, 12, 11, 13, 1);

  // 6. CLAN MASTER building (south-center): rows 18–26, cols 13–22 = wall
  _fill(g, 18, 13, 26, 22, 2);
  // Clan entrance: rows 18–19, cols 16–19 = floor (north side)
  _fill(g, 18, 16, 19, 19, 1);

  // 7. Optional NPC open area (south-east): rows 20–26, cols 26–33 = floor (already floor)
  _fill(g, 20, 26, 26, 33, 1);

  // 8. West connection to Aston Core: rows 12–17, cols 0–2 = floor
  _fill(g, 12, 0, 17, 2, 1);

  return g;
}

const tiles = buildTiles();

// Validate dimensions
if (tiles.length !== H) throw new Error(`serviceDistrict: tiles.length ${tiles.length} !== H ${H}`);
if (tiles[0].length !== W) throw new Error(`serviceDistrict: tiles[0].length ${tiles[0].length} !== W ${W}`);

export const SERVICE_DISTRICT_ZONE = {
  id: 'aston_service_district',
  config: { width: W, height: H, seed: 0x5E2D1 },
  playerStart: { x: -13, z: 0 },
  tiles,
  entities: [
    // offsetX=17.5, offsetZ=14.5 → world_x=col−17.5, world_z=row−14.5
    { id: 'sd_portal_west',        type: 'portal',      position: { x: -16, y:   0 } },
    { id: 'sd_npc_shopkeeper',     type: 'npc',         position: { x:   9, y:  -8 } },
    { id: 'sd_npc_shop_assistant', type: 'npc',         position: { x:  11, y:  -6 } },
    { id: 'sd_npc_banker',         type: 'npc',         position: { x:  -9, y:  -8 } },
    { id: 'sd_npc_clan_master',    type: 'npc',         position: { x:   0, y:   7 } },
    { id: 'sd_npc_guide',          type: 'npc',         position: { x:   8, y:   9 } },
    { id: 'sd_shop_trigger',       type: 'shop',        position: { x:  10, y:  -9 } },
    { id: 'sd_bank_trigger',       type: 'bank',        position: { x: -10, y:  -9 } },
    { id: 'sd_clan_trigger',       type: 'clan_master', position: { x:   0, y:   6 } },
  ],
  systems: {
    enemies: [],
    portals: [
      {
        entityId:   'sd_portal_west',
        targetZone: 'aston_core',
        radius:     2,
        spawnX:     13,
        spawnZ:     -3,
      },
    ],
  },
  encounters:  [],
  spawnPoints: [],
};

export function registerServiceZones(zoneManager) {
  zoneManager._generatedZones.set(SERVICE_DISTRICT_ZONE.id, SERVICE_DISTRICT_ZONE);
}
