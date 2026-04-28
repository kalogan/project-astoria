// Aston Core — safe city hub, 48×44, radial layout, no enemies.

function _grid(W, H, buildFn) {
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => buildFn(r, c))
  );
}

const W = 48;
const H = 44;

// Wall-post positions for teleporter plaza ring
const TELEPORTER_POSTS = new Set([
  '33,22', '33,25', '37,22', '37,25',
]);

function buildTile(r, c) {
  // Outer border
  if (r === 0 || r === H - 1 || c === 0 || c === W - 1) {
    // South main gate: rows 41–43, cols 21–26 = floor (exit corridor)
    if (r >= 41 && r <= 43 && c >= 21 && c <= 26) return 1;
    return 2;
  }

  // PALACE: rows 2–12, cols 16–31
  if (r >= 2 && r <= 12 && c >= 16 && c <= 31) return 2;

  // SHOPS (east): rows 15–26, cols 35–44
  if (r >= 15 && r <= 26 && c >= 35 && c <= 44) return 2;

  // BANK (west): rows 15–26, cols 3–12
  if (r >= 15 && r <= 26 && c >= 3 && c <= 12) return 2;

  // CLAN MASTER (south-east): rows 30–38, cols 35–43
  if (r >= 30 && r <= 38 && c >= 35 && c <= 43) return 2;

  // Teleporter plaza wall posts
  if (TELEPORTER_POSTS.has(`${r},${c}`)) return 2;

  // Interior is floor (stone paths are floor too — same tile value)
  return 1;
}

const tiles = _grid(W, H, buildTile);

export const ASTON_CORE_ZONE = {
  id: 'aston_core',
  config: { width: W, height: H, seed: 0xA57C0 },
  playerStart: { x: 0, z: 0 },
  tiles,
  entities: [
    // offsetX = (48-1)/2 = 23.5, offsetZ = (44-1)/2 = 21.5
    // world x = col − 23.5, world z = row − 21.5
    { id: 'aston_npc_herald',     type: 'npc',    position: { x: 0,   y: -10 } },
    { id: 'aston_npc_shopkeeper', type: 'npc',    position: { x: 17,  y:   2 } },
    { id: 'aston_npc_banker',     type: 'npc',    position: { x: -17, y:   2 } },
    { id: 'aston_npc_clanmaster', type: 'npc',    position: { x: 15,  y:  12 } },
    { id: 'aston_teleporter',     type: 'device', position: { x: 0,   y:  14 } },
    { id: 'aston_portal_south',   type: 'portal', position: { x: 0,   y:  21 } },
  ],
  systems: {
    portals: [
      {
        entityId:   'aston_portal_south',
        targetZone: 'Cameron',
        radius:     2,
        spawnX:     0,
        spawnZ:     0,
      },
    ],
    quests: [
      {
        id:    'quest_explore_aston',
        type:  'kill',
        title: 'Explore Aston',
        goal:  1,
      },
    ],
  },
  encounters: [],
};

export function registerAstonZones(zoneManager) {
  zoneManager._generatedZones.set(ASTON_CORE_ZONE.id, ASTON_CORE_ZONE);
}
