// ── Design tokens ──────────────────────────────────────────────────────────────
export const P = {
  bg:     '#06060e',
  panel:  '#0d0d1a',
  border: '#1e1e3a',
  text:   '#ccd6f6',
  muted:  '#4a5a7a',
  accent: '#00d4ff',
  good:   '#27ae60',
  warn:   '#e67e22',
};

// ── Tile system ────────────────────────────────────────────────────────────────
export const TILE_TYPES = { FLOOR: 1, WALL: 2, ROAD: 3 };

export const TILE_LABELS = {
  [TILE_TYPES.FLOOR]: 'Floor',
  [TILE_TYPES.WALL]:  'Wall',
  [TILE_TYPES.ROAD]:  'Road',
};

export const T_LABELS = {
  FLOOR_NEAR_WALL: 'Floor → Wall',
  FLOOR_NEAR_PATH: 'Floor → Road',
  PATH_NEAR_FLOOR: 'Road → Floor',
};

// ── Default tile config (mirrors tileRenderer.js defaults) ────────────────────
export const DEFAULT_CONFIG = {
  pal: {
    1: ['#c4a35a', '#c9aa62', '#bd9c50', '#c7a455', '#ba9e56'],
    2: ['#607080', '#5a6c7c', '#687484', '#5d6e78', '#637278'],
    3: ['#3c3c3c', '#383838', '#3e3b36', '#363636', '#3a3a38'],
  },
  transitions: {
    FLOOR_NEAR_WALL: '#b69248',
    FLOOR_NEAR_PATH: '#bb9c50',
    PATH_NEAR_FLOOR: '#3f3d38',
  },
  tProb: {
    FLOOR_NEAR_WALL: 0.50,
    FLOOR_NEAR_PATH: 0.55,
    PATH_NEAR_FLOOR: 0.45,
  },
  tileHeight: { 1: 0.2, 2: 1.5, 3: 0.2 },
};

// ── Pure utilities ─────────────────────────────────────────────────────────────
export function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

export function darken(hex, amount) {
  const [r,g,b] = hexToRgb(hex);
  return `rgb(${Math.max(0,r-amount)},${Math.max(0,g-amount)},${Math.max(0,b-amount)})`;
}

export function lighten(hex, amount) {
  const [r,g,b] = hexToRgb(hex);
  return `rgb(${Math.min(255,r+amount)},${Math.min(255,g+amount)},${Math.min(255,b+amount)})`;
}

// ── Tile color picker ─────────────────────────────────────────────────────────
// Uses the same deterministic hash as tileRenderer.js so the map editor
// preview matches the in-game appearance exactly.

function _hash(row, col) {
  let n = (Math.imul(row, 2999) ^ Math.imul(col, 7919)) | 0;
  n ^= (n >>> 16);
  n  = Math.imul(n, 0x45d9f3b | 0);
  n ^= (n >>> 16);
  return (n >>> 0) / 0x100000000;
}

function _hasNeighbor(grid, row, col, type) {
  const R = grid.length, C = grid[0].length;
  return (
    (row > 0     && grid[row-1][col] === type) ||
    (row < R - 1 && grid[row+1][col] === type) ||
    (col > 0     && grid[row][col-1] === type) ||
    (col < C - 1 && grid[row][col+1] === type)
  );
}

export function pickTileColor(type, row, col, grid, config) {
  const t   = _hash(row, col);
  const pal = config.pal[type];
  if (!pal) return '#808080';

  if (type === TILE_TYPES.FLOOR) {
    if (_hasNeighbor(grid, row, col, TILE_TYPES.WALL) && t < config.tProb.FLOOR_NEAR_WALL)
      return config.transitions.FLOOR_NEAR_WALL;
    if (_hasNeighbor(grid, row, col, TILE_TYPES.ROAD) && t < config.tProb.FLOOR_NEAR_PATH)
      return config.transitions.FLOOR_NEAR_PATH;
    return pal[(t * pal.length) | 0];
  }
  if (type === TILE_TYPES.WALL) {
    return pal[(t * pal.length) | 0];
  }
  if (type === TILE_TYPES.ROAD) {
    if (_hasNeighbor(grid, row, col, TILE_TYPES.FLOOR) && t < config.tProb.PATH_NEAR_FLOOR)
      return config.transitions.PATH_NEAR_FLOOR;
    return pal[(t * pal.length) | 0];
  }
  return '#808080';
}

// ── Isometric tile canvas drawer ───────────────────────────────────────────────
// Draws a single isometric tile (walls get side faces + elevated top face,
// flat tiles get shallow side faces).  Used by MapEditorTab's canvas renderer.

export function drawIsoTile(ctx, sx, sy, TW, TH, topColor, type, config) {
  const hw = TW * 0.5;
  const hh = TH * 0.5;

  if (type === TILE_TYPES.WALL) {
    const wallH = TH * 2.8 * (config.tileHeight[TILE_TYPES.WALL] / 1.5);

    // Left face (darkest)
    ctx.beginPath();
    ctx.moveTo(sx,      sy);
    ctx.lineTo(sx - hw, sy + hh);
    ctx.lineTo(sx - hw, sy + hh + wallH);
    ctx.lineTo(sx,      sy + wallH);
    ctx.closePath();
    ctx.fillStyle = darken(topColor, 40);
    ctx.fill();

    // Right face (medium)
    ctx.beginPath();
    ctx.moveTo(sx,      sy);
    ctx.lineTo(sx + hw, sy + hh);
    ctx.lineTo(sx + hw, sy + hh + wallH);
    ctx.lineTo(sx,      sy + wallH);
    ctx.closePath();
    ctx.fillStyle = darken(topColor, 20);
    ctx.fill();

    // Top face
    const wallTopY = sy - wallH;
    ctx.beginPath();
    ctx.moveTo(sx,      wallTopY);
    ctx.lineTo(sx - hw, wallTopY + hh);
    ctx.lineTo(sx,      wallTopY + TH);
    ctx.lineTo(sx + hw, wallTopY + hh);
    ctx.closePath();
    ctx.fillStyle = topColor;
    ctx.fill();
    ctx.strokeStyle = lighten(topColor, 20);
    ctx.lineWidth = 0.5;
    ctx.stroke();
  } else {
    const flatH = Math.max(1, Math.round(TH * 0.22 * (config.tileHeight[type] / 0.2)));

    // Left face
    ctx.beginPath();
    ctx.moveTo(sx,      sy);
    ctx.lineTo(sx - hw, sy + hh);
    ctx.lineTo(sx - hw, sy + hh + flatH);
    ctx.lineTo(sx,      sy + flatH);
    ctx.closePath();
    ctx.fillStyle = darken(topColor, 30);
    ctx.fill();

    // Right face
    ctx.beginPath();
    ctx.moveTo(sx,      sy);
    ctx.lineTo(sx + hw, sy + hh);
    ctx.lineTo(sx + hw, sy + hh + flatH);
    ctx.lineTo(sx,      sy + flatH);
    ctx.closePath();
    ctx.fillStyle = darken(topColor, 15);
    ctx.fill();

    // Top face
    ctx.beginPath();
    ctx.moveTo(sx,      sy);
    ctx.lineTo(sx - hw, sy + hh);
    ctx.lineTo(sx,      sy + TH);
    ctx.lineTo(sx + hw, sy + hh);
    ctx.closePath();
    ctx.fillStyle = topColor;
    ctx.fill();
  }
}

// ── Shared UI style helper ─────────────────────────────────────────────────────
export function btnStyle(color) {
  return {
    background:    'transparent',
    border:        `1px solid ${color}`,
    color,
    fontFamily:    'monospace',
    fontSize:      11,
    letterSpacing: 2,
    padding:       '9px 14px',
    cursor:        'pointer',
  };
}
