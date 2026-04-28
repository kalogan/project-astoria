// structureTile.js — bridge, dock, and pier rendering.
//
// Structures are entities (type: 'structure'), NOT tile types.
// They are drawn in a world-space pass ABOVE the tile layer.
//
// Bridge entity:
//   { type:'structure', subtype:'bridge', position, config:{ orientation:'ew'|'ns', length:3 } }
//   orientation: 'ew' (east-west) | 'ns' (north-south)
//   length: tiles spanned (centred on position)
//
// Dock / Pier entity:
//   { type:'structure', subtype:'dock'|'pier', position,
//     config:{ orientation:'north'|'south'|'east'|'west', length:3 } }
//   position: land tile where dock base is placed
//   orientation: direction from land into water
//   length: number of water tiles to extend (base tile + length segments)

// ── Palette ───────────────────────────────────────────────────────────────────

const BRIDGE_TOP   = [142, 102, 56];
const BRIDGE_LEFT  = [ 88,  60, 28];
const BRIDGE_RIGHT = [112,  78, 40];
const BRIDGE_ELEV  = 5;  // px above tile surface

const DOCK_TOP     = [134,  96, 52];
const DOCK_SIDE_L  = [ 82,  56, 24];
const DOCK_SIDE_R  = [102,  72, 36];
const DOCK_ELEV    = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _hash(row, col, salt = 0) {
  let n = (Math.imul(row * 2999 + (salt | 0), 1) ^ Math.imul(col, 7919)) | 0;
  n ^= n >>> 16;
  n  = Math.imul(n, 0x45d9f3b | 0);
  n ^= n >>> 16;
  return (n >>> 0) / 0x100000000;
}

function _rgb([r, g, b]) { return `rgb(${r},${g},${b})`; }


// ── Plank lines ───────────────────────────────────────────────────────────────
// Draws thin shadow lines across the top face to suggest wooden planks.
// Clip to diamond top face, then draw lines perpendicular to planksDir.

function _drawPlankLines(ctx, sx, sy, TW, TH, planksDir) {
  const hw = TW * 0.5;
  const hh = TH * 0.5;
  const n  = 4;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.lineTo(sx,      sy + TH);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.closePath();
  ctx.clip();

  ctx.strokeStyle = 'rgba(0,0,0,0.11)';
  ctx.lineWidth   = 0.65;

  for (let i = 1; i < n; i++) {
    const t = i / n;
    let x0, y0, x1, y1;
    if (planksDir === 'ew') {
      // Lines across the c-axis (NE direction in iso)
      x0 = sx - hw + t * TW;  y0 = sy + hh * (1 - t);
      x1 = sx + t * hw;       y1 = sy + TH * t;
    } else {
      // Lines across the r-axis (NW direction in iso)
      x0 = sx - hw * t;       y0 = sy + hh * t;
      x1 = sx + hw * (1 - t); y1 = sy + hh + hh * (1 - t);
    }
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Drop shadow on water surface beneath structure ────────────────────────────

function _drawShadow(ctx, sx, sy, TW, TH) {
  const hw = TW * 0.5;
  const hh = TH * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx,      sy);
  ctx.lineTo(sx - hw, sy + hh);
  ctx.lineTo(sx,      sy + TH);
  ctx.lineTo(sx + hw, sy + hh);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fill();
  ctx.restore();
}

// ── Bridge segment (single tile) ─────────────────────────────────────────────
// orientation: 'ew' | 'ns'  — used for the plank grain direction.

export function drawBridgeSegment(ctx, sx, sy, TW, TH, orientation, row, col) {
  const esy = sy - BRIDGE_ELEV;
  const hw  = TW * 0.5;
  const hh  = TH * 0.5;

  // Drop shadow on water surface
  _drawShadow(ctx, sx, sy, TW, TH);

  // ── Side faces
  ctx.beginPath();
  ctx.moveTo(sx,      esy);
  ctx.lineTo(sx - hw, esy + hh);
  ctx.lineTo(sx - hw, esy + hh + 4);
  ctx.lineTo(sx,      esy + 4);
  ctx.closePath();
  ctx.fillStyle = _rgb(BRIDGE_LEFT);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(sx,      esy);
  ctx.lineTo(sx + hw, esy + hh);
  ctx.lineTo(sx + hw, esy + hh + 4);
  ctx.lineTo(sx,      esy + 4);
  ctx.closePath();
  ctx.fillStyle = _rgb(BRIDGE_RIGHT);
  ctx.fill();

  // ── Top face — plank-grain gradient
  const [tr, tg, tb] = BRIDGE_TOP;
  const shift  = Math.round((_hash(row, col, 0) - 0.5) * 10);
  // Gradient runs across the tile, perpendicular to the planks
  const g0x = orientation === 'ew' ? sx - hw : sx;
  const g0y = orientation === 'ew' ? esy + hh : esy;
  const g1x = orientation === 'ew' ? sx + hw : sx;
  const g1y = orientation === 'ew' ? esy + hh : esy + TH;
  const grad = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
  const c = (base, d) => Math.max(0, Math.min(255, base + shift + d));
  grad.addColorStop(0,    `rgb(${c(tr,-8)},${c(tg,-5)},${c(tb,-3)})`);
  grad.addColorStop(0.40, `rgb(${c(tr,0)},${c(tg,0)},${c(tb,0)})`);
  grad.addColorStop(0.72, `rgb(${c(tr,-5)},${c(tg,-3)},${c(tb,-2)})`);
  grad.addColorStop(1,    `rgb(${c(tr,+9)},${c(tg,+6)},${c(tb,+3)})`);

  ctx.beginPath();
  ctx.moveTo(sx,      esy);
  ctx.lineTo(sx - hw, esy + hh);
  ctx.lineTo(sx,      esy + TH);
  ctx.lineTo(sx + hw, esy + hh);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Plank lines (grain hint perpendicular to orientation)
  _drawPlankLines(ctx, sx, esy, TW, TH, orientation === 'ew' ? 'ns' : 'ew');
}

// ── Dock / pier segment ───────────────────────────────────────────────────────
// orientation: 'north'|'south'|'east'|'west'  — dock runs in this direction.
// isBase: true for the land tile (thicker, with railings).
// segIdx: numeric index along extension, or 'tip' for the last segment.

export function drawDockSegment(ctx, sx, sy, TW, TH, orientation, isBase, segIdx, row, col) {
  const esy  = sy - DOCK_ELEV;
  const dH   = isBase ? 6 : 3;

  // Slight per-plank colour variation
  const shift = (_hash(row, col, segIdx === 'tip' ? 99 : segIdx) - 0.5) * 14;
  const [tr, tg, tb] = DOCK_TOP;
  const topColor = `rgb(${Math.round(tr+shift)},${Math.round(tg+shift)},${Math.round(tb+shift)})`;

  const hw = TW * 0.5;
  const hh = TH * 0.5;

  // Shadow on water (non-base segments only)
  if (!isBase) _drawShadow(ctx, sx, sy, TW, TH);

  // Left face
  ctx.beginPath();
  ctx.moveTo(sx,      esy);
  ctx.lineTo(sx - hw, esy + hh);
  ctx.lineTo(sx - hw, esy + hh + dH);
  ctx.lineTo(sx,      esy + dH);
  ctx.closePath();
  ctx.fillStyle = _rgb(DOCK_SIDE_L);
  ctx.fill();

  // Right face
  ctx.beginPath();
  ctx.moveTo(sx,      esy);
  ctx.lineTo(sx + hw, esy + hh);
  ctx.lineTo(sx + hw, esy + hh + dH);
  ctx.lineTo(sx,      esy + dH);
  ctx.closePath();
  ctx.fillStyle = _rgb(DOCK_SIDE_R);
  ctx.fill();

  // Top face
  ctx.beginPath();
  ctx.moveTo(sx,      esy);
  ctx.lineTo(sx - hw, esy + hh);
  ctx.lineTo(sx,      esy + TH);
  ctx.lineTo(sx + hw, esy + hh);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();

  // Plank grain perpendicular to dock direction
  const planksDir = (orientation === 'north' || orientation === 'south') ? 'ew' : 'ns';
  _drawPlankLines(ctx, sx, esy, TW, TH, planksDir);

  // Railing posts on tip segment
  if (segIdx === 'tip') {
    const postH = 9;
    const postW = 2;
    ctx.fillStyle = _rgb(DOCK_SIDE_L);
    // Left post (at left diamond vertex)
    ctx.fillRect(sx - hw - postW * 0.5, esy + hh - postH, postW, postH);
    // Right post (at right diamond vertex)
    ctx.fillRect(sx + hw - postW * 0.5, esy + hh - postH, postW, postH);
    // Cross-rail
    ctx.beginPath();
    ctx.moveTo(sx - hw, esy + hh - postH + 2);
    ctx.lineTo(sx + hw, esy + hh - postH + 2);
    ctx.strokeStyle = _rgb(DOCK_SIDE_R);
    ctx.lineWidth   = 1;
    ctx.stroke();
  }
}

// ── Direction helper for dock extension ──────────────────────────────────────

export const DOCK_DIR_DELTAS = {
  north: [-1,  0],
  south: [ 1,  0],
  east:  [ 0,  1],
  west:  [ 0, -1],
};
