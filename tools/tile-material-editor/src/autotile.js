// autotile.js — procedural terrain rendering with edge-blending transitions.
//
// Terrain tile IDs are in the 10–13 range to avoid colliding with legacy
// game tile IDs (FLOOR=1, WALL=2, ROAD=3).
//
// Rendering pipeline per tile:
//   1. Side faces (left darker, right medium) using base noisy color
//   2. Top diamond face with base noisy color
//   3. Transition gradient overlays — one per differing neighbor
//   4. Noise speckle — tiny scattered light/dark dots for texture

// ── Terrain type IDs ──────────────────────────────────────────────────────────
// IDs 10–13: standard surface terrain
// IDs 15–20: zone-specific terrain (sewer: 15-17, cave: 18-20)
// ID    14:  water (handled by waterTile.js — not a terrain tile)

export const TERRAIN_TYPES = {
  GRASS:   10,
  DIRT:    11,
  PATH:    12,
  STONE:   13,
  // Sewer
  BRICK:   15,
  SLUDGE:  16,
  GRATE:   17,
  // Cave
  ROCK:    18,
  MOSS:    19,
  CRYSTAL: 20,
};

export const TERRAIN_LABELS = {
  [TERRAIN_TYPES.GRASS]:   'Grass',
  [TERRAIN_TYPES.DIRT]:    'Dirt',
  [TERRAIN_TYPES.PATH]:    'Path',
  [TERRAIN_TYPES.STONE]:   'Stone',
  [TERRAIN_TYPES.BRICK]:   'Brick',
  [TERRAIN_TYPES.SLUDGE]:  'Sludge',
  [TERRAIN_TYPES.GRATE]:   'Grate',
  [TERRAIN_TYPES.ROCK]:    'Rock',
  [TERRAIN_TYPES.MOSS]:    'Moss',
  [TERRAIN_TYPES.CRYSTAL]: 'Crystal',
};

// Representative single color used in the editor palette swatch
export const TERRAIN_PREVIEW = {
  [TERRAIN_TYPES.GRASS]:   '#5a8e3a',
  [TERRAIN_TYPES.DIRT]:    '#8b6340',
  [TERRAIN_TYPES.PATH]:    '#9a8060',
  [TERRAIN_TYPES.STONE]:   '#6a7070',
  [TERRAIN_TYPES.BRICK]:   '#6e3d2a',
  [TERRAIN_TYPES.SLUDGE]:  '#445828',
  [TERRAIN_TYPES.GRATE]:   '#404044',
  [TERRAIN_TYPES.ROCK]:    '#363432',
  [TERRAIN_TYPES.MOSS]:    '#304820',
  [TERRAIN_TYPES.CRYSTAL]: '#505890',
};

// Flat height used for all terrain tiles (matches tileHeight of 0.2 floor tiles)
const TERRAIN_FLAT_H_RATIO = 0.22;

export function isTerrainTile(typeId) {
  // IDs 10-13 (standard) + 15-20 (zone-specific); 14 is water, handled separately
  return (typeId >= 10 && typeId <= 13) || (typeId >= 15 && typeId <= 20);
}

// ── Color palettes ────────────────────────────────────────────────────────────
// Five [r,g,b] variants per terrain type.  Deterministic hash picks one per
// tile, then a brightness jitter is applied on top.

const TERRAIN_PALETTES = {
  [TERRAIN_TYPES.GRASS]: [
    [90,  142, 58],  [85, 135, 54],  [96, 148, 63],  [88, 139, 56],  [93, 144, 61],
  ],
  [TERRAIN_TYPES.DIRT]: [
    [140, 100, 65], [133,  95, 59], [147, 105, 70], [137,  98, 63], [143, 103, 67],
  ],
  [TERRAIN_TYPES.PATH]: [
    [155, 130, 98], [148, 123, 91], [162, 137, 105], [152, 127, 95], [158, 133, 101],
  ],
  [TERRAIN_TYPES.STONE]: [
    [108, 114, 114], [101, 107, 107], [115, 121, 121], [104, 110, 110], [111, 117, 117],
  ],
  // ── Sewer tiles ──────────────────────────────────────────────────────────────
  [TERRAIN_TYPES.BRICK]: [
    [108, 60, 40],  [102, 55, 36],  [114, 65, 44],  [106, 58, 38],  [110, 62, 42],
  ],
  [TERRAIN_TYPES.SLUDGE]: [
    [66,  80, 44],  [62,  76, 40],  [70,  84, 48],  [64,  78, 42],  [68,  82, 46],
  ],
  [TERRAIN_TYPES.GRATE]: [
    [54,  54, 57],  [48,  48, 51],  [60,  60, 63],  [51,  51, 54],  [56,  56, 59],
  ],
  // ── Cave tiles ───────────────────────────────────────────────────────────────
  [TERRAIN_TYPES.ROCK]: [
    [50,  48, 46],  [45,  43, 41],  [55,  53, 51],  [47,  45, 43],  [52,  50, 48],
  ],
  [TERRAIN_TYPES.MOSS]: [
    [46,  66, 34],  [42,  62, 30],  [50,  70, 38],  [44,  64, 32],  [48,  68, 36],
  ],
  [TERRAIN_TYPES.CRYSTAL]: [
    [78,  88, 146], [73,  83, 140], [83,  93, 152], [76,  86, 143], [80,  90, 148],
  ],
};

// Debug-mode flat colors (one per type, no noise)
const TERRAIN_DEBUG_COLORS = {
  [TERRAIN_TYPES.GRASS]:   'rgb(90,142,58)',
  [TERRAIN_TYPES.DIRT]:    'rgb(140,100,65)',
  [TERRAIN_TYPES.PATH]:    'rgb(155,130,98)',
  [TERRAIN_TYPES.STONE]:   'rgb(108,114,114)',
  [TERRAIN_TYPES.BRICK]:   'rgb(108,60,40)',
  [TERRAIN_TYPES.SLUDGE]:  'rgb(66,80,44)',
  [TERRAIN_TYPES.GRATE]:   'rgb(54,54,57)',
  [TERRAIN_TYPES.ROCK]:    'rgb(50,48,46)',
  [TERRAIN_TYPES.MOSS]:    'rgb(46,66,34)',
  [TERRAIN_TYPES.CRYSTAL]: 'rgb(78,88,146)',
};

// ── Blend colors ──────────────────────────────────────────────────────────────
// Transition overlay color drawn along the shared edge between two terrain types.
// Key format: `${lowerTypeId}_${higherTypeId}`.

const BLEND_COLORS = {
  // Standard terrain pairs
  '10_11': [122, 120,  64],  // grass ↔ dirt
  '10_12': [136, 138,  80],  // grass ↔ path
  '10_13': [ 98, 112,  96],  // grass ↔ stone
  '11_12': [144, 113,  80],  // dirt  ↔ path
  '11_13': [118, 112,  96],  // dirt  ↔ stone
  '12_13': [134, 128, 112],  // path  ↔ stone
  // Sewer pairs
  '15_16': [ 86,  68,  42],  // brick  ↔ sludge
  '15_17': [ 78,  56,  48],  // brick  ↔ grate
  '16_17': [ 60,  66,  50],  // sludge ↔ grate
  // Cave pairs
  '18_19': [ 48,  60,  40],  // rock ↔ moss
  '18_20': [ 64,  70,  96],  // rock ↔ crystal
  '19_20': [ 62,  78,  92],  // moss ↔ crystal
  // Cross-set transitions (used when different zone tiles share edges)
  '13_18': [ 52,  52,  50],  // stone ↔ rock
  '11_15': [122,  78,  52],  // dirt  ↔ brick
  '12_16': [108, 106,  70],  // path  ↔ sludge
};

function _blendRgb(typeA, typeB) {
  const key = `${Math.min(typeA, typeB)}_${Math.max(typeA, typeB)}`;
  return BLEND_COLORS[key] ?? [128, 128, 128];
}

// ── Deterministic per-tile hash ───────────────────────────────────────────────
// Different `salt` values give independent random streams for the same tile.

function _hash(row, col, salt) {
  let n = (Math.imul(row * 2999 + (salt | 0), 1) ^ Math.imul(col, 7919)) | 0;
  n ^= (n >>> 16);
  n  = Math.imul(n, 0x45d9f3b | 0);
  n ^= (n >>> 16);
  return (n >>> 0) / 0x100000000;
}

// ── Base color computation ─────────────────────────────────────────────────────

function _baseRgb(typeId, row, col) {
  const pal = TERRAIN_PALETTES[typeId];
  if (!pal) return [128, 128, 128];
  const variant   = pal[Math.floor(_hash(row, col, 0) * pal.length)];
  const brightness = (_hash(row, col, 1) - 0.5) * 16; // ±8 per-channel jitter
  return [
    Math.max(0, Math.min(255, Math.round(variant[0] + brightness))),
    Math.max(0, Math.min(255, Math.round(variant[1] + brightness))),
    Math.max(0, Math.min(255, Math.round(variant[2] + brightness))),
  ];
}

function _rgb([r, g, b]) { return `rgb(${r},${g},${b})`; }

function _darkenRgb([r, g, b], amount) {
  return `rgb(${Math.max(0, r - amount)},${Math.max(0, g - amount)},${Math.max(0, b - amount)})`;
}

function _adjustRgb([r, g, b], amount) {
  const c = v => Math.max(0, Math.min(255, Math.round(v + amount)));
  return [c(r), c(g), c(b)];
}

const BRIGHTNESS_PER_LEVEL = 9; // keep in sync with heightMap.js

// ── Neighbor transition data ───────────────────────────────────────────────────
// Direction index → relative (dr, dc).
//
// Isometric screen-space mapping (from gridToScreen):
//   (r-1, c)  →  top-right  in screen  →  edge: top_vertex   → right_vertex
//   (r, c+1)  →  bot-right  in screen  →  edge: right_vertex → bottom_vertex
//   (r+1, c)  →  bot-left   in screen  →  edge: bottom_vertex→ left_vertex
//   (r, c-1)  →  top-left   in screen  →  edge: left_vertex  → top_vertex

const DIR_DELTAS = [
  { dr: -1, dc:  0 }, // 0 — top-right edge
  { dr:  0, dc:  1 }, // 1 — bottom-right edge
  { dr:  1, dc:  0 }, // 2 — bottom-left edge
  { dr:  0, dc: -1 }, // 3 — top-left edge
];

export function getTransitions(tiles, row, col) {
  const rows   = tiles.length;
  const cols   = tiles[0].length;
  const myType = tiles[row][col];
  const result = [];
  for (let i = 0; i < 4; i++) {
    const { dr, dc } = DIR_DELTAS[i];
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    const neighborType = tiles[nr][nc];
    if (neighborType === myType || neighborType === 0) continue;
    // Only blend when at least one side is a terrain tile
    if (!isTerrainTile(neighborType) && !isTerrainTile(myType)) continue;
    result.push({ dir: i, neighborType });
  }
  return result;
}

// ── Transition gradient overlay ───────────────────────────────────────────────
// Draws a gradient-filled triangular sector over the shared edge of the top
// diamond face.  Triangles cover 1/4 of the diamond each:
//
//   dir 0: [top,   right,  center]  (top-right  quadrant)
//   dir 1: [right, bottom, center]  (bottom-right quadrant)
//   dir 2: [bottom,left,   center]  (bottom-left  quadrant)
//   dir 3: [left,  top,    center]  (top-left     quadrant)
//
// Gradient runs from blend color (semi-transparent) at the edge midpoint
// to fully transparent at the diamond center — giving a feathered edge.

function _drawTransition(ctx, sx, sy, TW, TH, myType, neighborType, dir, row, col) {
  const hw = TW * 0.5;
  const hh = TH * 0.5;

  const top    = [sx,      sy];
  const right  = [sx + hw, sy + hh];
  const bottom = [sx,      sy + TH];
  const left   = [sx - hw, sy + hh];
  const center = [sx,      sy + hh]; // center of diamond

  const TRIS = [
    [top, right, center],
    [right, bottom, center],
    [bottom, left, center],
    [left, top, center],
  ];

  const [v0, v1, v2] = TRIS[dir];
  const edgeMidX = (v0[0] + v1[0]) * 0.5;
  const edgeMidY = (v0[1] + v1[1]) * 0.5;

  const [br, bg, bb] = _blendRgb(myType, neighborType);
  const opacity      = 0.42 + _hash(row, col, dir + 2) * 0.28; // 0.42–0.70

  const grad = ctx.createLinearGradient(edgeMidX, edgeMidY, center[0], center[1]);
  grad.addColorStop(0,    `rgba(${br},${bg},${bb},${opacity.toFixed(3)})`);
  grad.addColorStop(0.60, `rgba(${br},${bg},${bb},${(opacity * 0.12).toFixed(3)})`);
  grad.addColorStop(1,    `rgba(${br},${bg},${bb},0)`);

  // Clip to triangle, fill diamond-sized rect with the gradient
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(v0[0], v0[1]);
  ctx.lineTo(v1[0], v1[1]);
  ctx.lineTo(v2[0], v2[1]);
  ctx.closePath();
  ctx.clip();

  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.lineTo(sx,      sy + TH);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

// ── Noise speckle ─────────────────────────────────────────────────────────────
// Scatters tiny light/dark dots inside the diamond using the diamond's own
// parametric space — no clip needed, all points land inside the shape.

function _drawSpeckle(ctx, sx, sy, TW, TH, typeId, row, col) {
  const hw      = TW * 0.5;
  const hh      = TH * 0.5;
  const nDots   = 4 + Math.floor(_hash(row, col, 10) * 4); // 4–7 dots
  const centerY = sy + hh;

  for (let i = 0; i < nDots; i++) {
    // Diamond parametrization: P = center + (u - v)·hw_vec + (u + v - 1)·hh_vec
    // where hw_vec = (hw, 0) and hh_vec = (0, hh), u,v ∈ [0,1].
    // Shrink slightly (0.85) so dots never land on the very border.
    const u  = _hash(row, col, 20 + i * 2);
    const v  = _hash(row, col, 21 + i * 2);
    const px = sx + (u - v) * hw * 0.85;
    const py = centerY + (u + v - 1) * hh * 0.85;

    const bright  = _hash(row, col, 40 + i) > 0.5;
    const opacity = 0.07 + _hash(row, col, 50 + i) * 0.11; // 0.07–0.18

    ctx.beginPath();
    ctx.arc(px, py, 0.9, 0, Math.PI * 2);
    ctx.fillStyle = bright
      ? `rgba(255,255,255,${opacity.toFixed(3)})`
      : `rgba(0,0,0,${opacity.toFixed(3)})`;
    ctx.fill();
  }
}

// ── Public draw entry point ───────────────────────────────────────────────────

/**
 * Draw a single terrain tile at screen position (sx, sy).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number}   sx        world-space x of tile top vertex (height offset already applied by caller)
 * @param {number}   sy        world-space y of tile top vertex (height offset already applied by caller)
 * @param {number}   TW        tile width constant
 * @param {number}   TH        tile height constant
 * @param {number}   typeId    TERRAIN_TYPES value
 * @param {number}   row
 * @param {number}   col
 * @param {number[][]} tiles   full zone tile grid (for neighbor lookups)
 * @param {boolean}  debugMode when true: flat color, no blending, no speckle
 * @param {number}   h         elevation level (0 = ground) — drives brightness
 * @param {number}   cliffR    right-face cliff extension in pixels (pre-multiplied)
 * @param {number}   cliffL    left-face cliff extension in pixels (pre-multiplied)
 */
export function drawTerrainTile(ctx, sx, sy, TW, TH, typeId, row, col, tiles, debugMode,
                                h = 0, cliffR = 0, cliffL = 0) {
  const hw    = TW * 0.5;
  const hh    = TH * 0.5;
  const baseH = Math.max(1, Math.round(TH * TERRAIN_FLAT_H_RATIO));
  const lfH   = baseH + cliffL; // left-face total height (px)
  const rfH   = baseH + cliffR; // right-face total height (px)

  // Apply height brightness: higher = brighter
  const rawRgb   = debugMode ? null : _baseRgb(typeId, row, col);
  const litRgb   = (rawRgb && h) ? _adjustRgb(rawRgb, h * BRIGHTNESS_PER_LEVEL) : rawRgb;
  const topColor = debugMode ? TERRAIN_DEBUG_COLORS[typeId] : _rgb(litRgb ?? rawRgb);
  const leftFace = debugMode ? topColor : _darkenRgb(litRgb ?? rawRgb, 30);
  const rightFace= debugMode ? topColor : _darkenRgb(litRgb ?? rawRgb, 15);

  // ── Left face (cliff-extended) ──────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.lineTo(sx - hw, sy + hh + lfH);
  ctx.lineTo(sx,      sy + lfH);
  ctx.closePath();
  ctx.fillStyle = leftFace;
  ctx.fill();

  // ── Right face (cliff-extended) ─────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.lineTo(sx + hw, sy + hh + rfH);
  ctx.lineTo(sx,      sy + rfH);
  ctx.closePath();
  ctx.fillStyle = rightFace;
  ctx.fill();

  // ── Top face ────────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.lineTo(sx,      sy + TH);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();

  if (debugMode) return;

  // ── Transition overlays ──────────────────────────────────────────────────────
  const transitions = getTransitions(tiles, row, col);
  for (const { dir, neighborType } of transitions) {
    _drawTransition(ctx, sx, sy, TW, TH, typeId, neighborType, dir, row, col);
  }

  // ── Noise speckle ────────────────────────────────────────────────────────────
  _drawSpeckle(ctx, sx, sy, TW, TH, typeId, row, col);
}
