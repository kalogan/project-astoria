// waterTile.js — procedural water, shoreline, river-flow, and waterfall rendering.
//
// Water tile ID: 14.  Stored in zone.tiles like any other tile type.
// Flow direction: zone.waterFlow[row][col] = null | 'north'|'east'|'south'|'west'
//
// Rendering layers per tile:
//   1. Side faces       (left darker, right medium — like terrain tiles)
//   2. Top face         (depth-modulated blue, specular sheen)
//   3. Shoreline gradients  (sandy foam toward every land-adjacent edge)
//   4. Flow streaks         (if flow direction is set — river mode)
//   5. Foam speckle         (scattered dots near shoreline)
//
// Waterfall (separate call, from higher water tile):
//   drawWaterfallFace   — animated streaks on the visible side face
//   drawSplashEffect    — foam dots at the base tile after the fall

export const WATER_TYPE = 14;

// ── Color definitions ─────────────────────────────────────────────────────────

// Shallow → deep gradient (3 stops, interpolated by depth 0–1)
const DEPTH_COLORS = [
  [82,  168, 208],  // shallow — cyan-blue
  [48,  120, 175],  // medium
  [22,   68, 135],  // deep
];

const SHORE_RGB  = [218, 200, 158];  // sandy foam at edges
const FLOW_RGB   = [120, 188, 232];  // lighter streak for river flow
const FALL_RGB   = [178, 222, 255];  // bright white-blue for waterfall face
const SPLASH_RGB = [210, 238, 255];  // splash dots at fall base

const TERRAIN_FLAT_H = 0.22;  // matches autotile TERRAIN_FLAT_H_RATIO
const HEIGHT_SCALE   = 14;    // keep in sync with heightMap.js

// ── Deterministic hash ────────────────────────────────────────────────────────

function _hash(row, col, salt = 0) {
  let n = (Math.imul(row * 2999 + (salt | 0), 1) ^ Math.imul(col, 7919)) | 0;
  n ^= n >>> 16;
  n  = Math.imul(n, 0x45d9f3b | 0);
  n ^= n >>> 16;
  return (n >>> 0) / 0x100000000;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function _rgb([r, g, b])     { return `rgb(${r},${g},${b})`; }
function _rgba([r, g, b], a) { return `rgba(${r},${g},${b},${a.toFixed(3)})`; }

function _darkenRgb([r, g, b], n) {
  return `rgb(${Math.max(0,r-n)},${Math.max(0,g-n)},${Math.max(0,b-n)})`;
}

function _lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ── Depth computation ─────────────────────────────────────────────────────────
// Returns 0.0 (shallow / near shore) … 1.0 (deep / open water).
// Based on 8-neighbour land count + tile height (higher = shallower).

export function getWaterDepth(tiles, row, col, heights) {
  const rows = tiles.length;
  const cols = tiles[0].length;
  let land = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) { land++; continue; }
      if (tiles[nr][nc] !== WATER_TYPE) land++;
    }
  }
  const shoreFactor = 1 - land / 8;
  const h           = heights?.[row]?.[col] ?? 0;
  const hFactor     = h > 0 ? Math.max(0, 1 - h * 0.3) : 1;
  return Math.max(0, Math.min(1, shoreFactor * hFactor));
}

// ── Neighbour direction table ─────────────────────────────────────────────────

const DIR_DELTAS = [
  { dr: -1, dc:  0 }, // 0 top-right
  { dr:  0, dc:  1 }, // 1 bottom-right
  { dr:  1, dc:  0 }, // 2 bottom-left
  { dr:  0, dc: -1 }, // 3 top-left
];

// ── Shoreline edge gradient ───────────────────────────────────────────────────
// Draws a sandy-foam gradient fading from the land edge toward the tile center.

function _drawShoreGradient(ctx, sx, sy, TW, TH, dir, row, col) {
  const hw = TW * 0.5;
  const hh = TH * 0.5;

  const top    = [sx,      sy];
  const right  = [sx + hw, sy + hh];
  const bottom = [sx,      sy + TH];
  const left   = [sx - hw, sy + hh];
  const center = [sx,      sy + hh];

  const TRIS = [
    [top,    right,  center],
    [right,  bottom, center],
    [bottom, left,   center],
    [left,   top,    center],
  ];
  const [v0, v1, v2] = TRIS[dir];
  const edgeMidX = (v0[0] + v1[0]) * 0.5;
  const edgeMidY = (v0[1] + v1[1]) * 0.5;

  const opacity = 0.50 + _hash(row, col, dir + 8) * 0.32;

  const grad = ctx.createLinearGradient(edgeMidX, edgeMidY, center[0], center[1]);
  grad.addColorStop(0,    _rgba(SHORE_RGB, opacity));
  grad.addColorStop(0.40, _rgba(SHORE_RGB, opacity * 0.28));
  grad.addColorStop(1,    _rgba(SHORE_RGB, 0));

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

// ── River flow streaks ────────────────────────────────────────────────────────
// Animated light streaks scrolling in the flow direction.

function _drawFlowStreaks(ctx, sx, sy, TW, TH, flowDir, row, col, animOffset) {
  const hw = TW * 0.5;
  const hh = TH * 0.5;

  // Screen-space unit vectors aligned to the four iso axes
  const FLOW_VEC = {
    north: [ hw * 0.65,  -hh * 0.65],
    south: [-hw * 0.65,   hh * 0.65],
    east:  [ hw * 0.65,   hh * 0.65],
    west:  [-hw * 0.65,  -hh * 0.65],
  };
  const [fdx, fdy] = FLOW_VEC[flowDir] ?? [0, 0];
  if (!fdx && !fdy) return;

  const cx = sx;
  const cy = sy + hh;

  ctx.save();
  // Clip all streaks to the tile diamond
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.lineTo(sx,      sy + TH);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.closePath();
  ctx.clip();

  const nStreaks = 4;
  for (let i = 0; i < nStreaks; i++) {
    const perpFrac = (_hash(row, col, 60 + i) - 0.5) * 0.75;
    const perpX    = -fdy * perpFrac;
    const perpY    =  fdx * perpFrac;

    const phase = (_hash(row, col, 70 + i) + animOffset * (0.22 + i * 0.09)) % 1;
    const t     = phase - 0.5;
    const scx   = cx + perpX + fdx * t;
    const scy   = cy + perpY + fdy * t;

    const len   = 0.35 + _hash(row, col, 80 + i) * 0.35;
    const alpha = 0.09 + _hash(row, col, 90 + i) * 0.13;

    const x0 = scx - fdx * len * 0.5;
    const y0 = scy - fdy * len * 0.5;
    const x1 = scx + fdx * len * 0.5;
    const y1 = scy + fdy * len * 0.5;

    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0,   _rgba(FLOW_RGB, 0));
    grad.addColorStop(0.5, _rgba(FLOW_RGB, alpha));
    grad.addColorStop(1,   _rgba(FLOW_RGB, 0));

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 1.1 + _hash(row, col, 100 + i) * 1.3;
    ctx.lineCap     = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

// ── Foam speckle near shore ───────────────────────────────────────────────────

function _drawFoamSpeckle(ctx, sx, sy, TW, TH, hasShore, row, col) {
  if (!hasShore) return;
  const hw      = TW * 0.5;
  const hh      = TH * 0.5;
  const centerY = sy + hh;
  const nDots   = 3 + Math.floor(_hash(row, col, 30) * 4);

  for (let i = 0; i < nDots; i++) {
    const u  = _hash(row, col, 120 + i * 2);
    const v  = _hash(row, col, 121 + i * 2);
    const px = sx + (u - v) * hw * 0.80;
    const py = centerY + (u + v - 1) * hh * 0.80;
    const a  = 0.04 + _hash(row, col, 130 + i) * 0.09;
    ctx.beginPath();
    ctx.arc(px, py, 0.9, 0, Math.PI * 2);
    ctx.fillStyle = _rgba([235, 248, 255], a);
    ctx.fill();
  }
}

// ── Main water tile draw ──────────────────────────────────────────────────────

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number}      sx, sy      top-vertex world position (height already applied by caller)
 * @param {number}      TW, TH      tile constants
 * @param {number}      row, col    grid position
 * @param {number[][]}  tiles       full zone tile grid
 * @param {number[][]|null} heights zone.heights for depth
 * @param {string[][]|null} waterFlow zone.waterFlow for river streaks
 * @param {number}      animOffset  0-inf scrolling phase (time-based, modded in caller)
 * @param {number}      cliffR      right-face cliff extension px (from height system)
 * @param {number}      cliffL      left-face cliff extension px
 * @param {object|null} waterMod    zone env water modifier { murky, dark, speedMul }
 */
export function drawWaterTile(ctx, sx, sy, TW, TH, row, col, tiles, heights,
                               waterFlow, animOffset, cliffR, cliffL, waterMod) {
  const hw    = TW * 0.5;
  const hh    = TH * 0.5;
  const depth = getWaterDepth(tiles, row, col, heights);

  // Interpolate depth colour
  const dScaled = depth * (DEPTH_COLORS.length - 1);
  const dIdx    = Math.floor(dScaled);
  const dFrac   = dScaled - dIdx;
  const rawRgb  = dIdx >= DEPTH_COLORS.length - 1
    ? DEPTH_COLORS[DEPTH_COLORS.length - 1]
    : _lerpRgb(DEPTH_COLORS[dIdx], DEPTH_COLORS[dIdx + 1], dFrac);

  // Per-tile noise ±10 brightness
  const jitter  = (_hash(row, col, 0) - 0.5) * 20;
  let   baseRgb = rawRgb.map(v => Math.max(0, Math.min(255, Math.round(v + jitter))));

  // Zone-environment water modifications
  if (waterMod?.murky) {
    // Sewer: push green up, reduce red and blue → murky green-brown tint
    baseRgb = [
      Math.max(0, baseRgb[0] - 12),
      Math.min(255, baseRgb[1] + 20),
      Math.max(0, baseRgb[2] - 28),
    ];
  }
  if (waterMod?.dark) {
    // Cave: reduce red and green, push blue up slightly → cold dark water
    baseRgb = [
      Math.max(0, baseRgb[0] - 14),
      Math.max(0, baseRgb[1] - 18),
      Math.min(255, baseRgb[2] + 12),
    ];
  }

  const baseH = Math.max(1, Math.round(TH * TERRAIN_FLAT_H));
  const lfH   = baseH + (cliffL ?? 0);
  const rfH   = baseH + (cliffR ?? 0);

  // ── Left face
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.lineTo(sx - hw, sy + hh + lfH);
  ctx.lineTo(sx,      sy + lfH);
  ctx.closePath();
  ctx.fillStyle = _darkenRgb(baseRgb, 36);
  ctx.fill();

  // ── Right face
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.lineTo(sx + hw, sy + hh + rfH);
  ctx.lineTo(sx,      sy + rfH);
  ctx.closePath();
  ctx.fillStyle = _darkenRgb(baseRgb, 18);
  ctx.fill();

  // ── Top face
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.lineTo(sx,      sy + TH);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.closePath();
  ctx.fillStyle = _rgb(baseRgb);
  ctx.fill();

  // ── Specular sheen (subtle gradient toward top vertex; stronger for cave dark water)
  {
    const sheenTop = waterMod?.dark ? 0.18 : 0.09;
    const grad = ctx.createLinearGradient(sx, sy, sx, sy + TH);
    grad.addColorStop(0,    `rgba(255,255,255,${sheenTop})`);
    grad.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx,      sy);
    ctx.lineTo(sx - hw, sy + hh);
    ctx.lineTo(sx,      sy + TH);
    ctx.lineTo(sx + hw, sy + hh);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // ── Shoreline gradients
  const rows = tiles.length;
  const cols = tiles[0].length;
  let hasShore = false;
  for (let d = 0; d < 4; d++) {
    const { dr, dc } = DIR_DELTAS[d];
    const nr = row + dr, nc = col + dc;
    const isLand = (nr < 0 || nr >= rows || nc < 0 || nc >= cols || tiles[nr][nc] !== WATER_TYPE);
    if (isLand) {
      hasShore = true;
      _drawShoreGradient(ctx, sx, sy, TW, TH, d, row, col);
    }
  }

  // ── River flow streaks (speed scaled by zone waterMod.speedMul)
  const flow      = waterFlow?.[row]?.[col] ?? null;
  const speedMul  = waterMod?.speedMul ?? 1.0;
  if (flow) _drawFlowStreaks(ctx, sx, sy, TW, TH, flow, row, col, animOffset * speedMul);

  // ── Foam speckle
  _drawFoamSpeckle(ctx, sx, sy, TW, TH, hasShore, row, col);
}

// ── Waterfall face ────────────────────────────────────────────────────────────
// Overlaid on the SIDE FACE of the HIGHER water tile when its right (col+1)
// or left (row+1) neighbour is a lower water tile.
//
// face:       'right' (toward col+1) | 'left' (toward row+1)
// heightDiff: height units the water drops (≥1)

export function drawWaterfallFace(ctx, sx, sy, TW, TH, face, heightDiff, row, col, animOffset) {
  const hw    = TW * 0.5;
  const hh    = TH * 0.5;
  const fallH = heightDiff * HEIGHT_SCALE;

  const pts = face === 'left'
    ? [[sx, sy], [sx - hw, sy + hh], [sx - hw, sy + hh + fallH], [sx, sy + fallH]]
    : [[sx, sy], [sx + hw, sy + hh], [sx + hw, sy + hh + fallH], [sx, sy + fallH]];

  const [p0, p1, p2, p3] = pts;
  const faceW = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.lineTo(p3[0], p3[1]);
  ctx.closePath();
  ctx.clip();

  // Base fill
  ctx.fillStyle = _rgb(FALL_RGB);
  ctx.fill();

  // Animated vertical streaks
  const nStreaks = 5;
  for (let i = 0; i < nStreaks; i++) {
    const tPos  = _hash(row, col, 200 + i);
    const px    = p0[0] + (p1[0] - p0[0]) * tPos;
    const py    = p0[1] + (p1[1] - p0[1]) * tPos;
    const animT = (_hash(row, col, 210 + i) + (animOffset % 100) * 0.65) % 1;
    const len   = fallH * (0.30 + _hash(row, col, 220 + i) * 0.35);
    const alpha = 0.18 + _hash(row, col, 230 + i) * 0.24;
    const dropY = animT * fallH;

    const grad = ctx.createLinearGradient(px, py + dropY, px, py + dropY + len);
    grad.addColorStop(0,   'rgba(255,255,255,0)');
    grad.addColorStop(0.3, `rgba(255,255,255,${alpha.toFixed(3)})`);
    grad.addColorStop(0.7, `rgba(255,255,255,${alpha.toFixed(3)})`);
    grad.addColorStop(1,   'rgba(255,255,255,0)');

    ctx.fillStyle = grad;
    ctx.fillRect(Math.min(p0[0], p1[0]) - 1, py + dropY, faceW + 2, len);
  }
  ctx.restore();
}

// ── Splash / foam at waterfall base ──────────────────────────────────────────
// Called on the LOWER water tile after the tile is rendered.

export function drawSplashEffect(ctx, sx, sy, TW, TH, row, col, animOffset) {
  const hw      = TW * 0.5;
  const hh      = TH * 0.5;
  const centerY = sy + hh;
  const nDots   = 7 + Math.floor(_hash(row, col, 150) * 5);

  for (let i = 0; i < nDots; i++) {
    const angle = _hash(row, col, 160 + i) * Math.PI * 2;
    const rFrac = 0.08 + _hash(row, col, 170 + i) * 0.42;
    const phase = (_hash(row, col, 180 + i) + (animOffset % 100) * 1.3) % 1;
    const alpha = (1 - phase) * (0.16 + _hash(row, col, 190 + i) * 0.18);
    const dotR  = 0.8 + phase * 2.0;

    const px = sx      + Math.cos(angle) * hw * rFrac * 0.72;
    const py = centerY + Math.sin(angle) * hh * rFrac * 0.72;

    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fillStyle = _rgba(SPLASH_RGB, alpha);
    ctx.fill();
  }
}

export function isWaterTile(typeId) { return typeId === WATER_TYPE; }
