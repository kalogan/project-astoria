// heightMap.js — height/elevation utilities for the map editor.
//
// Heights are stored in zone.heights: a 2D array of integers, same dimensions
// as zone.tiles.  They are PURELY VISUAL and do NOT change grid structure,
// collider data, or any game logic.
//
// Height data shape:  zone.heights[row][col]  ∈ [0, MAX_HEIGHT]
// Absent or undefined entries default to 0 (ground level).

export const HEIGHT_SCALE         = 14;  // world-space px offset per height unit
export const MAX_HEIGHT           = 6;
export const MIN_HEIGHT           = 0;
export const BRIGHTNESS_PER_LEVEL = 9;   // colour brightness delta per height unit

// ── Data helpers ──────────────────────────────────────────────────────────────

/**
 * Safe getter — returns 0 for any out-of-bounds or absent coordinate.
 */
export function getH(heights, row, col) {
  return heights?.[row]?.[col] ?? 0;
}

/**
 * Return zone.heights as-is if it matches tile dimensions; otherwise build a
 * fresh all-zero array with the correct shape.
 */
export function ensureHeights(zone) {
  const rows = zone.tiles.length;
  const cols = zone.tiles[0].length;
  const h    = zone.heights;
  if (h && h.length === rows && (h[0]?.length ?? 0) === cols) return h;
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function _parse(str) {
  if (!str) return [128, 128, 128];
  if (str.startsWith('rgb')) {
    const m = str.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [+m[1], +m[2], +m[3]];
  }
  if (str.startsWith('#')) {
    const s = str.replace('#', '');
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
    ];
  }
  return [128, 128, 128];
}

const _c = v => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Shift a CSS colour string (rgb() or hex) brighter/darker based on tile height.
 * Higher height → brighter.  Height 0 → unchanged.
 */
export function applyHeightBrightness(colorStr, height) {
  if (!height) return colorStr;
  const [r, g, b] = _parse(colorStr);
  const a = height * BRIGHTNESS_PER_LEVEL;
  return `rgb(${_c(r + a)},${_c(g + a)},${_c(b + a)})`;
}

/**
 * Shadow alpha for a height difference of `diff` levels.
 */
export function shadowOpacity(diff) {
  return Math.min(0.52, diff * 0.17);
}
