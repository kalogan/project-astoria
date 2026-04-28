// fovUtils.js — simple raycasting field-of-view system.
//
// Used by the editor for the FOV debug overlay.
// Game runtime would call computeFOV from the player's position each frame.
//
// Algorithm:
//   - Cast `rayCount` rays at equal angular intervals from the origin.
//   - Each ray walks outward one step at a time until it hits a blocking tile
//     or exceeds `radius`.
//   - All traversed cells are marked visible.
//
// `isBlockingTile(typeId)` returns true for tiles that stop the ray.

import { TILE_TYPES } from './constants';

export function isBlockingTile(typeId) {
  return typeId === TILE_TYPES.WALL;
}

/**
 * Compute the set of visible grid cells from (originX, originY).
 *
 * @param {number}   originX  tile column of viewer
 * @param {number}   originY  tile row of viewer
 * @param {number[][]} tiles  zone tile grid
 * @param {number}   radius   max tiles of visibility
 * @param {number}   [rayCount=360]  angular resolution
 * @returns {Set<string>}  Set of "row,col" keys
 */
export function computeFOV(originX, originY, tiles, radius = 10, rayCount = 360) {
  const rows   = tiles.length;
  const cols   = tiles[0]?.length ?? 0;
  const visible = new Set();

  // Always visible: origin itself
  visible.add(`${originY},${originX}`);

  const step = (Math.PI * 2) / rayCount;

  for (let i = 0; i < rayCount; i++) {
    const angle = i * step;
    const dx    = Math.cos(angle);
    const dy    = Math.sin(angle);

    let rx = originX + 0.5;
    let ry = originY + 0.5;

    for (let d = 0; d < radius; d++) {
      const gx = Math.floor(rx);
      const gy = Math.floor(ry);

      if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) break;

      visible.add(`${gy},${gx}`);

      if (isBlockingTile(tiles[gy][gx])) break;

      rx += dx;
      ry += dy;
    }
  }

  return visible;
}

/**
 * Draw the FOV debug overlay on the canvas.
 * Called in screen space (after ctx.restore from world transform).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Set<string>} visibleSet  from computeFOV
 * @param {number[][]}  tiles
 * @param {object}      ISO_ORIGIN
 * @param {number}      TW, TH
 * @param {object}      camera  { panX, panY, zoom }
 * @param {function}    gridToScreen
 */
export function drawFOVOverlay(ctx, visibleSet, tiles, ISO_ORIGIN, TW, TH, camera, gridToScreen) {
  const { panX, panY, zoom } = camera;
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;

  ctx.save();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (tiles[r][c] === 0) continue;
      if (visibleSet.has(`${r},${c}`)) continue;   // visible — skip darkening

      const { x: wx, y: wy } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
      const sx  = wx * zoom + panX;
      const sy  = wy * zoom + panY;
      const shw = TW * zoom * 0.5;
      const shh = TH * zoom * 0.5;

      ctx.beginPath();
      ctx.moveTo(sx,       sy);
      ctx.lineTo(sx - shw, sy + shh);
      ctx.lineTo(sx,       sy + TH * zoom);
      ctx.lineTo(sx + shw, sy + shh);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.60)';
      ctx.fill();
    }
  }

  // Visible cell highlight tint
  ctx.globalAlpha = 0.08;
  for (const key of visibleSet) {
    const [r, c] = key.split(',').map(Number);
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    const { x: wx, y: wy } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
    const sx  = wx * zoom + panX;
    const sy  = wy * zoom + panY;
    const shw = TW * zoom * 0.5;
    const shh = TH * zoom * 0.5;
    ctx.beginPath();
    ctx.moveTo(sx,       sy);
    ctx.lineTo(sx - shw, sy + shh);
    ctx.lineTo(sx,       sy + TH * zoom);
    ctx.lineTo(sx + shw, sy + shh);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,160,1)';
    ctx.fill();
  }

  ctx.restore();
}
