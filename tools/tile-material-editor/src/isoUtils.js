/**
 * Convert grid (row, col) to 2D canvas world-space position using isometric
 * projection.  Matches the transform used by tileRenderer.js viewed through
 * Three.js's orthographic isometric camera.
 *
 * @param {number} row
 * @param {number} col
 * @param {{x: number, y: number}} origin  iso origin in world space
 * @param {number} TW  base tile width
 * @param {number} TH  base tile height (TW * 0.5)
 * @returns {{x: number, y: number}}
 */
export function gridToScreen(row, col, origin, TW, TH) {
  return {
    x: origin.x + (col - row) * TW * 0.5,
    y: origin.y + (col + row) * TH * 0.5,
  };
}

/**
 * Convert a world-space canvas position back to grid (row, col).
 * Returns null if the result falls outside [0, rows) × [0, cols).
 *
 * @param {number} sx  x in world space
 * @param {number} sy  y in world space
 * @param {{x: number, y: number}} origin
 * @param {number} TW
 * @param {number} TH
 * @param {number} rows
 * @param {number} cols
 * @returns {{row: number, col: number} | null}
 */
export function screenToGrid(sx, sy, origin, TW, TH, rows, cols) {
  const dx  = (sx - origin.x) / (TW * 0.5);
  const dy  = (sy - origin.y) / (TH * 0.5);
  const col = Math.floor((dx + dy) / 2);
  const row = Math.floor((dy - dx) / 2);
  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  return { row, col };
}
