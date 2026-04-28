// Aston Service District — functional services hub, 32×28, safe zone, no enemies.

function _grid(W, H, buildFn) {
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => buildFn(r, c))
  );
}

const W = 32;
const H = 28;

function buildTile(r, c) {
  // Outer border
  if (r === 0 || r === H - 1 || c === 0 || c === W - 1) {
    // West exit back to Aston Core: rows 11–16, cols 0–2 = floor
    if (r >= 11 && r <= 16 && c >= 0 && c <= 2) return 1;
    return 2;
  }

  // SHOP building: rows 3–10, cols 3–12
  if (r >= 3 && r <= 10 && c >= 3 && c <= 12) return 2;

  // BANK building: rows 3–10, cols 19–28
  if (r >= 3 && r <= 10 && c >= 19 && c <= 28) return 2;

  // CLAN MASTER building: rows 16–23, cols 10–21
  if (r >= 16 && r <= 23 && c >= 10 && c <= 21) return 2;

  return 1;
}

const tiles = _grid(W, H, buildTile);

export const SERVICE_DISTRICT_ZONE = {
  id: 'aston_service_district',
  config: { width: W, height: H, seed: 0x5E2D1 },
  playerStart: { x: 0, z: 0 },
  tiles,
  entities: [
    // offsetX = (32-1)/2 = 15.5, offsetZ = (28-1)/2 = 13.5
    // world x = col − 15.5, world z = row − 13.5
    { id: 'svc_npc_shopkeeper', type: 'npc',    position: { x: -8,  y: -5 } },
    { id: 'svc_npc_banker',     type: 'npc',    position: { x:  8,  y: -5 } },
    { id: 'svc_npc_clanmaster', type: 'npc',    position: { x:  0,  y:  7 } },
    { id: 'svc_portal_west',    type: 'portal', position: { x: -14, y:  2 } },
  ],
  systems: {
    portals: [
      {
        entityId:   'svc_portal_west',
        targetZone: 'aston_core',
        radius:     2,
        spawnX:     17,
        spawnZ:     2,
      },
    ],
  },
  encounters: [],
};

export function registerServiceZones(zoneManager) {
  zoneManager._generatedZones.set(SERVICE_DISTRICT_ZONE.id, SERVICE_DISTRICT_ZONE);
}
