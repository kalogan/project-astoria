// zoneEnv.js — zone environment system.
//
// zone.type: 'surface' | 'sewer' | 'cave'
//
// Environment configs drive:
//   - Canvas tint overlay (global colour cast applied over all tiles)
//   - Vignette (radial darkening in screen space)
//   - Water modification (murky/dark/speed)
//   - Which zone-specific tile types appear in the active palette
//   - Ambient lighting hint shown in the editor status bar

// ── Zone type identifiers ─────────────────────────────────────────────────────

export const ZONE_TYPES  = { SURFACE: 'surface', SEWER: 'sewer', CAVE: 'cave' };
export const ZONE_LABELS = { surface: 'Surface', sewer: 'Sewer', cave: 'Cave' };

// ── Environment configs ───────────────────────────────────────────────────────
//
// tileTint:  { r, g, b, opacity } — additive RGBA rect over world-space tiles
// vignette:  { color:[r,g,b], opacity } — radial gradient in screen space
// waterMod:  { murky, dark, speedMul } — modifies drawWaterTile appearance
// tilesetIds: tile type IDs shown in the palette for this zone type
//             null = standard terrain palette (GRASS/DIRT/PATH/STONE/WATER)

export const ZONE_ENV = {
  surface: {
    label:      'Surface',
    tileTint:   null,
    vignette:   { color: [0, 0, 0], opacity: 0 },
    waterMod:   { murky: false, dark: false, speedMul: 1.0 },
    tilesetIds: null,   // show all standard terrain types
    ambient:    '#ffffff',
  },
  sewer: {
    label:      'Sewer',
    tileTint:   { r: 28, g: 48, b: 8, opacity: 0.30 },
    vignette:   { color: [2, 7, 2], opacity: 0.52 },
    waterMod:   { murky: true,  dark: false, speedMul: 0.35 },
    tilesetIds: [15, 16, 17],   // BRICK, SLUDGE, GRATE
    ambient:    '#a0bb90',
  },
  cave: {
    label:      'Cave',
    tileTint:   { r: 12, g: 12, b: 32, opacity: 0.24 },
    vignette:   { color: [3, 3, 10], opacity: 0.60 },
    waterMod:   { murky: false, dark: true,  speedMul: 0.55 },
    tilesetIds: [18, 19, 20],   // ROCK, MOSS, CRYSTAL
    ambient:    '#8890a8',
  },
};

// ── Zone-specific tile type IDs ───────────────────────────────────────────────
// IDs 15–20 extend the terrain autotile range (10–13).
// They are registered in autotile.js TERRAIN_TYPES / TERRAIN_PALETTES.

export const SEWER_TILE_TYPES = { BRICK: 15, SLUDGE: 16, GRATE: 17 };
export const CAVE_TILE_TYPES  = { ROCK:  18, MOSS:   19, CRYSTAL: 20 };

export const ZONE_TILE_IDS = {
  ...SEWER_TILE_TYPES,
  ...CAVE_TILE_TYPES,
};

export const ZONE_TILE_LABELS = {
  15: 'Brick',
  16: 'Sludge',
  17: 'Grate',
  18: 'Rock',
  19: 'Moss',
  20: 'Crystal',
};

// Representative swatch colours for the editor palette
export const ZONE_TILE_PREVIEW = {
  15: '#6e3d2a',  // brick
  16: '#445828',  // sludge
  17: '#404044',  // grate
  18: '#363432',  // rock
  19: '#304820',  // moss
  20: '#505890',  // crystal
};

// ── Vignette draw helper ──────────────────────────────────────────────────────
// Call in screen space (after ctx.restore from world-space transform).

export function drawVignette(ctx, W, H, vignette) {
  if (!vignette || vignette.opacity <= 0) return;
  const [vr, vg, vb] = vignette.color;
  const innerR = Math.min(W, H) * 0.20;
  const outerR = Math.max(W, H) * 0.78;
  const grad = ctx.createRadialGradient(W / 2, H / 2, innerR, W / 2, H / 2, outerR);
  grad.addColorStop(0, `rgba(${vr},${vg},${vb},0)`);
  grad.addColorStop(1, `rgba(${vr},${vg},${vb},${vignette.opacity.toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// ── Tint draw helper ──────────────────────────────────────────────────────────
// Call inside world-space transform (after all tiles), before ctx.restore.

export function drawEnvTint(ctx, tileTint, minX, minY, spanW, spanH) {
  if (!tileTint || tileTint.opacity <= 0) return;
  const { r, g, b, opacity } = tileTint;
  ctx.fillStyle = `rgba(${r},${g},${b},${opacity.toFixed(3)})`;
  ctx.fillRect(minX, minY, spanW, spanH);
}
