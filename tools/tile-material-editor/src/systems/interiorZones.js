// interiorZones.js — interior region detection and cutaway logic.
//
// "Interior" tiles = non-wall floor tiles not reachable from the map edge via
// flood fill.  Used for:
//   - Switching the lighting zone (darker inside buildings)
//   - Fading/hiding front-facing walls when the player is inside (cutaway)
//
// computeInteriorTiles() is expensive — cache the result and recompute only
// when the tile grid changes.

import { TILE_TYPES } from '../constants';

const WALL = TILE_TYPES.WALL;

// ── Interior detection (flood fill from edges) ────────────────────────────────
//
// Returns a Set<"col,row"> of tiles enclosed by walls.

export function computeInteriorTiles(tiles) {
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;
  if (!rows || !cols) return new Set();

  const visited = new Uint8Array(rows * cols);
  const stack   = [];

  // Seed the flood fill from every non-wall border cell
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r !== 0 && r !== rows - 1 && c !== 0 && c !== cols - 1) continue;
      if (tiles[r][c] === WALL) continue;
      const idx = r * cols + c;
      if (!visited[idx]) { visited[idx] = 1; stack.push(r * cols + c); }
    }
  }

  // 4-directional flood fill marking all externally reachable floor tiles
  while (stack.length) {
    const enc = stack.pop();
    const r   = Math.floor(enc / cols);
    const c   = enc % cols;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const idx = nr * cols + nc;
      if (visited[idx] || tiles[nr][nc] === WALL) continue;
      visited[idx] = 1;
      stack.push(nr * cols + nc);
    }
  }

  // Interior = non-wall tiles that were NOT visited from the edge
  const interior = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (tiles[r][c] !== WALL && !visited[r * cols + c]) {
        interior.add(`${c},${r}`);
      }
    }
  }
  return interior;
}

// ── Debug overlay ─────────────────────────────────────────────────────────────

export function drawInteriorZoneOverlay(ctx, interiorTiles, tiles, camera, gridToScreen, ISO_ORIGIN, TW, TH, heights, HEIGHT_SCALE) {
  if (!interiorTiles?.size) return;
  const { panX, panY, zoom } = camera;
  const hw = TW * 0.5 * zoom, hh = TH * 0.5 * zoom, th = TH * zoom;

  ctx.save();
  ctx.globalAlpha = 0.28;
  for (const key of interiorTiles) {
    const [c, r] = key.split(',').map(Number);
    const h   = heights?.[r]?.[c] ?? 0;
    const { x: wx, y: wyBase } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
    const wy  = wyBase - h * HEIGHT_SCALE;
    const sx  = wx * zoom + panX;
    const sy  = wy * zoom + panY;
    ctx.beginPath();
    ctx.moveTo(sx,       sy);
    ctx.lineTo(sx - hw,  sy + hh);
    ctx.lineTo(sx,       sy + th);
    ctx.lineTo(sx + hw,  sy + hh);
    ctx.closePath();
    ctx.fillStyle = 'rgba(160,100,255,1)';
    ctx.fill();
  }
  ctx.restore();
}

// ── Player zone detection ─────────────────────────────────────────────────────

export function getPlayerZone(playerCol, playerRow, interiorTiles) {
  return interiorTiles.has(`${playerCol},${playerRow}`) ? 'interior' : 'exterior';
}

// Smooth transition factor: 0 = fully exterior, 1 = fully interior.
// Looks at a 5×5 neighbourhood to avoid sharp switching in corridors.
export function computeTransitionFactor(playerCol, playerRow, interiorTiles) {
  const RADIUS = 2;
  let inside = 0, total = 0;
  for (let dr = -RADIUS; dr <= RADIUS; dr++) {
    for (let dc = -RADIUS; dc <= RADIUS; dc++) {
      total++;
      if (interiorTiles.has(`${playerCol + dc},${playerRow + dr}`)) inside++;
    }
  }
  return total > 0 ? inside / total : 0;
}

// ── Cutaway ───────────────────────────────────────────────────────────────────
// Returns 0–1 alpha for a wall tile during the tile render pass.
// Walls "in front of" the player (lower screenY in iso) fade to reveal interior.
//
// playerScreenY: screen-space Y of the player's tile top-vertex.
// tileScreenY:   screen-space Y of this tile's top-vertex.
// transitionFactor: 0 = outside, 1 = deep inside.

export function getCutawayAlpha(tileType, tileScreenY, playerScreenY, transitionFactor) {
  if (tileType !== WALL)      return 1.0;          // non-wall: always fully visible
  if (transitionFactor < 0.1) return 1.0;          // player outside: no cutaway
  if (tileScreenY >= playerScreenY - 4) return 1.0; // tile is behind/at player: visible

  // How far above the player is this wall?
  const dist   = playerScreenY - tileScreenY;
  const fade   = Math.min(1, dist / 90);           // full fade within 90 screen px
  const minAlpha = 0.12;
  const alpha  = Math.max(minAlpha, 1.0 - fade * (0.88 * transitionFactor));
  return alpha;
}

// ── Zone lighting presets ─────────────────────────────────────────────────────

export const ZONE_LIGHTING_CONFIG = {
  exterior: {
    darkAlpha:  0.0,                          // no darkness outside
    ambientRgb: { r: 120, g: 140, b: 180 },  // cool outdoor ambient
  },
  interior: {
    darkAlpha:  0.80,                         // strong darkness inside
    ambientRgb: { r: 255, g: 178, b: 95  },  // warm indoor ambient
  },
};

function _lerp(a, b, t) { return a + (b - a) * t; }

export function getBlendedLightingConfig(transitionFactor) {
  const ext = ZONE_LIGHTING_CONFIG.exterior;
  const int_ = ZONE_LIGHTING_CONFIG.interior;
  const t    = Math.max(0, Math.min(1, transitionFactor));
  return {
    darkAlpha:  _lerp(ext.darkAlpha,           int_.darkAlpha,           t),
    ambientRgb: {
      r: Math.round(_lerp(ext.ambientRgb.r, int_.ambientRgb.r, t)),
      g: Math.round(_lerp(ext.ambientRgb.g, int_.ambientRgb.g, t)),
      b: Math.round(_lerp(ext.ambientRgb.b, int_.ambientRgb.b, t)),
    },
  };
}
