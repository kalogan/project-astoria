// pentagramPitZone.js — circular ritual arena, single entrance, enclosed.
// 26 wide × 26 tall
// offsetX = (26-1)/2 = 12.5   offsetZ = (26-1)/2 = 12.5
// world x = col − 12.5        world z = row − 12.5

function _grid(W, H, fn) {
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => fn(r, c))
  );
}

const PIT_W = 26;
const PIT_H = 26;

function pitTile(r, c) {
  // Single entrance (north): rows 0–3, cols 11–14 = floor
  if (r >= 0 && r <= 3 && c >= 11 && c <= 14) return 1;

  // Thick border walls — 2 layers on all sides
  if (r <= 1 || r >= 24 || c <= 1 || c >= 24) return 2;

  // Interior: rows 2–23, cols 2–23 = floor by default
  // Boundary corner posts
  if ((r === 4  && c === 4)  ||
      (r === 4  && c === 21) ||
      (r === 21 && c === 4)  ||
      (r === 21 && c === 21)) return 2;

  // Central ritual circle indicator (wall posts around centre)
  if ((r === 10 && c === 12) ||
      (r === 10 && c === 13) ||
      (r === 15 && c === 12) ||
      (r === 15 && c === 13) ||
      (r === 12 && c === 10) ||
      (r === 13 && c === 10) ||
      (r === 12 && c === 15) ||
      (r === 13 && c === 15)) return 2;

  return 1;
}

const pitTiles = _grid(PIT_W, PIT_H, pitTile);

export const PENTAGRAM_PIT_ZONE = {
  id: 'pentagram_pit',
  config: { width: PIT_W, height: PIT_H, seed: 0xE4A55 },
  playerStart: { x: 0, z: -9 },
  tiles: pitTiles,
  entities: [
    // North portal: entrance area, world z ≈ row 1 − 12.5 = −11
    { id: 'pit_portal_north', type: 'portal',    position: { x:  0, y: -11 } },
    // Pentagram interaction point: world centre (0, 0)
    { id: 'pit_pentagram',    type: 'pentagram', position: { x:  0, y:   0 } },
  ],
  systems: {
    portals: [
      {
        entityId:   'pit_portal_north',
        targetZone: 'aston_core',
        radius:     2,
        spawnX:     0,
        spawnZ:     14,
      },
    ],
    enemies: [],
    quests:  [],
  },
  encounters: [],
  spawnPoints: [],
};

export function registerPentagramZones(zoneManager) {
  zoneManager._generatedZones.set(PENTAGRAM_PIT_ZONE.id, PENTAGRAM_PIT_ZONE);
}
