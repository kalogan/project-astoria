// caveGen.js — procedural cave generator using cellular automata.
//
// Algorithm:
//   1. Randomly fill grid (WALL vs FLOOR) at the given fill percentage.
//   2. Apply smoothing rules N times: cell becomes WALL if ≥5 of its 8
//      neighbours are walls, FLOOR if ≤2 are walls, otherwise unchanged.
//   3. Flood-fill to find connected floor regions; keep only the largest,
//      fill isolated regions with WALL.
//   4. Assign height variation using multi-scale hash noise (0–3 levels).
//   5. Place WATER tiles on the lowest accessible floor tiles.
//
// Output matches the zone JSON format used by MapEditorTab.

import { mulberry32 } from './constants';
import { TILE_TYPES   } from './constants';
import { CAVE_TILE_TYPES } from './zoneEnv';
import { WATER_TYPE } from './waterTile';

const FLOOR = CAVE_TILE_TYPES.ROCK;  // cave floor uses rock autotile
const WALL  = TILE_TYPES.WALL;

// ── Deterministic hash for height noise ───────────────────────────────────────

function _hash(r, c, salt = 0) {
  let n = (Math.imul(r * 2999 + (salt | 0), 1) ^ Math.imul(c, 7919)) | 0;
  n ^= n >>> 16;
  n  = Math.imul(n, 0x45d9f3b | 0);
  n ^= n >>> 16;
  return (n >>> 0) / 0x100000000;
}

// ── Neighbour wall count ───────────────────────────────────────────────────────

function countWallNeighbours(grid, r, c, rows, cols) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) n++;  // out-of-bounds counts as wall
      else if (grid[nr][nc] === WALL) n++;
    }
  }
  return n;
}

// ── Step 1: Random fill ───────────────────────────────────────────────────────

function randomFill(rows, cols, fillPct, rng) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return WALL;
      return rng() < fillPct / 100 ? WALL : FLOOR;
    })
  );
}

// ── Step 2: Smoothing ─────────────────────────────────────────────────────────

function smooth(grid, rows, cols) {
  return grid.map((row, r) =>
    row.map((cell, c) => {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return WALL;
      const walls = countWallNeighbours(grid, r, c, rows, cols);
      if (walls >= 5) return WALL;
      if (walls <= 2) return FLOOR;
      return cell;
    })
  );
}

// ── Step 3: Keep largest connected floor region ───────────────────────────────

function keepLargestRegion(grid, rows, cols) {
  const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
  const regions = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!visited[r][c] && grid[r][c] !== WALL) {
        const region = [];
        const stack  = [[r, c]];
        while (stack.length) {
          const [cr, cc] = stack.pop();
          if (cr < 0 || cr >= rows || cc < 0 || cc >= cols) continue;
          if (visited[cr][cc] || grid[cr][cc] === WALL) continue;
          visited[cr][cc] = 1;
          region.push(cr * cols + cc);
          stack.push([cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]);
        }
        regions.push(region);
      }
    }
  }

  if (!regions.length) return grid;

  const largest    = regions.reduce((a, b) => a.length > b.length ? a : b);
  const keepSet    = new Set(largest);

  const next = grid.map((row, r) =>
    row.map((cell, c) => {
      if (cell !== WALL && !keepSet.has(r * cols + c)) return WALL;
      return cell;
    })
  );
  return next;
}

// ── Step 4: Height variation (multi-scale noise, 0–3) ─────────────────────────

function buildCaveHeights(grid, rows, cols, seed) {
  const h = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === WALL) continue;
      // Three octaves of hash noise (large → small scale)
      const n0 = _hash(Math.floor(r / 5) + seed, Math.floor(c / 5), 0);
      const n1 = _hash(Math.floor(r / 3) + seed, Math.floor(c / 3), 1) * 0.55;
      const n2 = _hash(r + seed,                  c,                 2) * 0.30;
      const raw = (n0 + n1 + n2) / 1.85;
      h[r][c]  = Math.round(raw * 3); // 0–3
    }
  }
  return h;
}

// ── Step 5: Add water to lowest accessible tiles ──────────────────────────────

function addCaveWater(grid, heights, rows, cols, waterFraction) {
  // Collect floor tiles sorted by height (lowest first)
  const floorTiles = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== WALL) floorTiles.push({ r, c, h: heights[r][c] });

  floorTiles.sort((a, b) => a.h - b.h);

  const waterCount = Math.round(floorTiles.length * waterFraction);
  const tiles      = grid.map(row => [...row]);
  const hs         = heights.map(row => [...row]);

  for (let i = 0; i < waterCount; i++) {
    const { r, c } = floorTiles[i];
    tiles[r][c] = WATER_TYPE;
    hs[r][c]    = 0;  // water tiles sit at ground level
  }

  // Ensure water tiles don't create isolated water regions in the middle of land:
  // Only keep water tiles that have at least one non-wall neighbour also water OR border a wall.
  // (This is already somewhat handled by the fraction approach, but leave as-is for simplicity.)

  return { tiles, heights: hs };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a cave zone.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.fillPercent   0–100, higher = more walls (45 is typical)
 * @param {number} opts.smoothSteps  number of CA smoothing iterations (4–7)
 * @param {number} opts.seed         integer seed for reproducibility
 * @param {number} [opts.waterFraction=0.08]  fraction of floor tiles converted to water
 * @returns {object} zone object matching the MapEditorTab format
 */
export function generateCave({
  width         = 60,
  height        = 60,
  fillPercent   = 46,
  smoothSteps   = 5,
  seed          = 12345,
  waterFraction = 0.08,
}) {
  const rng = mulberry32(seed);

  // Step 1–2: fill + smooth
  let grid = randomFill(height, width, fillPercent, rng);
  for (let i = 0; i < smoothSteps; i++) {
    grid = smooth(grid, height, width);
  }

  // Step 3: connectivity
  grid = keepLargestRegion(grid, height, width);

  // Step 4: height variation
  const heights = buildCaveHeights(grid, height, width, seed % 1000);

  // Step 5: water
  const { tiles, heights: finalH } = addCaveWater(grid, heights, height, width, waterFraction);

  // Find a valid player start (first floor tile near centre)
  let startRow = Math.floor(height / 2), startCol = Math.floor(width / 2);
  outer: for (let dr = 0; dr < height; dr++) {
    for (let dc = 0; dc < width; dc++) {
      for (const [rr, cc] of [[startRow+dr, startCol+dc],[startRow-dr,startCol-dc]]) {
        if (rr >= 0 && rr < height && cc >= 0 && cc < width && tiles[rr][cc] !== WALL) {
          startRow = rr; startCol = cc;
          break outer;
        }
      }
    }
  }

  return {
    id:          `cave_${seed}`,
    name:        `Cave (seed ${seed})`,
    type:        'cave',
    config:      { width, height, seed },
    playerStart: { x: startCol - width / 2, z: startRow - height / 2 },
    tiles,
    heights:     finalH,
    entities:    [],
    systems:     { keys: [], doors: [], enemies: [], portals: [], quests: [] },
  };
}
