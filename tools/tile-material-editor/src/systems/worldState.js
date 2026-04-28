// worldState.js — canonical shape of the map world passed to the renderer.
//
// The full zone JSON contains additional editor metadata (name, id, type,
// lighting presets, config, etc.), but the renderer contract only depends
// on the fields defined below.  Keeping this explicit makes it safe to
// pass any object that satisfies the shape — including partial mocks for tests.
//
// ────────────────────────────────────────────────────────────────────────────
// WorldState shape (JSDoc typedef — no runtime overhead)
// ────────────────────────────────────────────────────────────────────────────
//
// @typedef {Object} WorldState
// @property {number[][]}        tiles     — 2D grid, 0 = empty, >0 = tile type
// @property {number[][]|null}   heights   — per-cell elevation (0 = flat)
// @property {PropData[]|null}   props     — decorative objects
// @property {EntityData[]|null} entities  — NPCs, enemies, spawn points, …
// @property {LightData[]|null}  lights    — manually-placed light sources
// @property {Object|null}       surface   — painted surface overlays { "col,row": string[] }
// @property {Object|null}       waterFlow — per-cell water flow direction
//
// @typedef {Object} PropData
// @property {string} id
// @property {string} type
// @property {number} x   — grid col
// @property {number} y   — grid row
// @property {number} [scale]
// @property {string} [facing]
//
// @typedef {Object} EntityData
// @property {string}  id
// @property {string}  type
// @property {string}  subtype
// @property {{ x: number, y: number }} position  — world-space (not grid)
// @property {string}  [facing]
// @property {Object}  [config]
//
// @typedef {Object} LightData
// @property {string}  id
// @property {string}  type    — 'torch' | 'fire' | 'magic' | 'crystal' | 'candle' | 'ambient'
// @property {number}  x       — grid col
// @property {number}  y       — grid row
// @property {number}  radius
// @property {number}  intensity
// @property {{ r: number, g: number, b: number }} color
// @property {boolean} flicker
// @property {number}  [flickerSpeed]
//
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the WorldState fields from a full zone object.
 * Returns null when zone is falsy.
 *
 * @param {Object|null} zone
 * @returns {import('./worldState').WorldState | null}
 */
export function worldFromZone(zone) {
  if (!zone) return null;
  return {
    tiles:     zone.tiles,
    heights:   zone.heights   ?? null,
    props:     zone.props     ?? null,
    entities:  zone.entities  ?? null,
    lights:    zone.lights    ?? null,
    surface:   zone.surface   ?? null,
    waterFlow: zone.waterFlow ?? null,
  };
}

/**
 * Return the row count of a world's tile grid (0 if empty).
 * @param {import('./worldState').WorldState} world
 */
export function worldRows(world) { return world?.tiles?.length ?? 0; }

/**
 * Return the col count of a world's tile grid (0 if empty).
 * @param {import('./worldState').WorldState} world
 */
export function worldCols(world) { return world?.tiles?.[0]?.length ?? 0; }
