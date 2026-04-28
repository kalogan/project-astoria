// pickingSystem.js — canonical tile-picking math for the isometric map editor.
//
// All mouse → grid conversions MUST go through pickTile().  Using the same
// constants and the exact inverse of gridToScreen() here guarantees that
// clicking any tile always paints that exact tile — no rounding drift, no
// zoom-applied-twice, no origin mismatch.
//
// gridToScreen (from isoUtils.js):
//   x = (col - row) * TILE_W / 2
//   y = (col + row) * TILE_H / 2
//
// Inverse (what pickTile uses):
//   dx = x / (TILE_W / 2)  →  col - row
//   dy = y / (TILE_H / 2)  →  col + row
//   col = floor((dx + dy) / 2)
//   row = floor((dy - dx) / 2)

// ── Shared tile constants ──────────────────────────────────────────────────────
// These match MapEditorTab.jsx's TW / TH.  Kept here so both the renderer
// and the picker always use the same numbers.

export const TILE_W    = 64;   // diamond width  in world units
export const TILE_H    = 32;   // diamond height in world units
export const ISO_ORIG  = Object.freeze({ x: 0, y: 0 });

// ── Mouse → canvas-relative point ─────────────────────────────────────────────

/**
 * Extract the canvas-relative pixel position from a MouseEvent.
 * Uses getBoundingClientRect() so it is correct regardless of scroll,
 * CSS transforms on parent elements, or DevicePixelRatio.
 *
 * @param {MouseEvent}        e
 * @param {HTMLCanvasElement} canvas
 * @returns {{ x: number, y: number }}
 */
export function canvasPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ── Canvas → world space ───────────────────────────────────────────────────────

/**
 * Convert a canvas-pixel point to world space, accounting for camera pan and
 * zoom.  The camera transform applied during rendering is:
 *   ctx.setTransform(zoom, 0, 0, zoom, panX, panY)
 *
 * The inverse is used here — pan first, then divide by zoom:
 *   worldX = (canvasX - panX) / zoom
 *   worldY = (canvasY - panY) / zoom
 *
 * @param {number} canvasX
 * @param {number} canvasY
 * @param {{ panX: number, panY: number, zoom: number }} camera
 * @returns {{ x: number, y: number }}
 */
export function canvasToWorld(canvasX, canvasY, camera) {
  return {
    x: (canvasX - camera.panX) / camera.zoom,
    y: (canvasY - camera.panY) / camera.zoom,
  };
}

// ── World space → grid tile ────────────────────────────────────────────────────

/**
 * Convert a world-space point to the grid tile it falls in.
 * Returns null when the point is outside the map bounds.
 *
 * This is the exact algebraic inverse of gridToScreen() in isoUtils.js —
 * do NOT modify either function independently.
 *
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} rows
 * @param {number} cols
 * @returns {{ row: number, col: number } | null}
 */
export function worldToTile(worldX, worldY, rows, cols) {
  const dx  = worldX / (TILE_W * 0.5);   // col - row
  const dy  = worldY / (TILE_H * 0.5);   // col + row
  const col = Math.floor((dx + dy) * 0.5);
  const row = Math.floor((dy - dx) * 0.5);
  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  return { row, col };
}

// ── Primary picking entry-point ────────────────────────────────────────────────

/**
 * The single function all mouse handlers should call to resolve a tile.
 *
 * Usage:
 *   const tile = pickTile(mx, my, camera, zone.tiles.length, zone.tiles[0].length);
 *   // tile is { row, col } or null (off-map)
 *
 * @param {number}  canvasX  — from canvasPoint(e, canvas).x
 * @param {number}  canvasY  — from canvasPoint(e, canvas).y
 * @param {{ panX: number, panY: number, zoom: number }} camera
 * @param {number}  rows
 * @param {number}  cols
 * @returns {{ row: number, col: number } | null}
 */
export function pickTile(canvasX, canvasY, camera, rows, cols) {
  const { x: wx, y: wy } = canvasToWorld(canvasX, canvasY, camera);
  return worldToTile(wx, wy, rows, cols);
}
