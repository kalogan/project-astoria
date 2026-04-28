import React, { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import { P, TILE_TYPES, TILE_LABELS, deepClone, pickTileColor, drawIsoTile, btnStyle } from './constants';
import { gridToScreen, screenToGrid, gridToWorld, worldToGrid } from './isoUtils';
import {
  TERRAIN_TYPES, TERRAIN_LABELS, TERRAIN_PREVIEW,
  isTerrainTile, drawTerrainTile,
} from './autotile';
import {
  HEIGHT_SCALE, MAX_HEIGHT, MIN_HEIGHT,
  getH, ensureHeights, applyHeightBrightness, shadowOpacity,
} from './heightMap';
import {
  WATER_TYPE, drawWaterTile, drawWaterfallFace, drawSplashEffect, isWaterTile,
} from './waterTile';
import { drawBridgeSegment, drawDockSegment, DOCK_DIR_DELTAS } from './structureTile';
import {
  ZONE_ENV, ZONE_LABELS,
  ZONE_TILE_IDS, ZONE_TILE_LABELS, ZONE_TILE_PREVIEW,
  drawVignette, drawEnvTint,
} from './zoneEnv';
import { generateCave }   from './caveGen';
import { generateDungeon } from './dungeonGen';
import { populateDungeon, ROOM_TYPE_COLORS, ROOM_TYPE_LABELS } from './questGen';
import { PROP_DEFS, PROP_CATEGORIES, detectWallDirection, canPlaceProp } from './propDefs';
import { drawProp, propSortKey } from './propRenderer';
import { PREFABS, rotatePrefab, canPlacePrefab, applyPrefab } from './prefabs/prefabDefs';
import { computeFOV, drawFOVOverlay } from './fovUtils';
import {
  buildFrameLights, tickLights, drawLightingPass,
} from './systems/lightingSystem';
import {
  computeInteriorTiles, getCutawayAlpha, computeTransitionFactor,
  getBlendedLightingConfig, drawInteriorZoneOverlay,
} from './systems/interiorZones';
import {
  generateLoot, lootLine, CONTAINER_LOOT_TABLES,
} from './systems/lootTables';
import {
  LIGHTING_PRESETS, presetDarkAlpha,
} from './data/lightingPresets';
import { LIGHT_PRESETS } from './systems/lightingSystem';

// ── Constants ──────────────────────────────────────────────────────────────────
const TW             = 64;
const TH             = 32;
const ISO_ORIGIN     = { x: 0, y: 0 };
const FALLBACK_ZONES = ['Cameron_Start', 'Cameron_Forest', 'zone_01', 'zone_02'];
const ZOOM_MIN       = 0.25;
const ZOOM_MAX       = 4;
const HISTORY_LIMIT  = 50;

// ── Module-level helpers ───────────────────────────────────────────────────────

/** Deterministic per-tile brightness hash (0–1). */
function tileHash(row, col) {
  let h = ((row * 2654435761 + col * 2246822519) >>> 0);
  h ^= h >>> 16;
  h  = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return h / 0xFFFFFFFF;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** Screen-space hit test for manually-placed lights (zone.lights). */
function lightHitTest(mouseX, mouseY, zone, camera, heights) {
  if (!zone?.lights?.length) return null;
  const { panX, panY, zoom } = camera;
  const HIT_R = 16;
  for (const light of zone.lights) {
    const h = heights?.[light.y]?.[light.x] ?? 0;
    const { x: wx, y: wyBase } = gridToScreen(light.y, light.x, ISO_ORIGIN, TW, TH);
    const wy = wyBase - h * HEIGHT_SCALE;
    const sx = wx * zoom + panX;
    const sy = (wy + TH * 0.5) * zoom + panY;
    if (Math.hypot(mouseX - sx, mouseY - sy) <= HIT_R) return light;
  }
  return null;
}

// ── Entity palette ─────────────────────────────────────────────────────────────
const ENTITY_PALETTE = [
  { type: 'npc',       subtype: 'greeter',  label: 'NPC: Greeter',    color: '#4fc38a', icon: 'N', defaultConfig: { dialogue: 'intro_greeter' } },
  { type: 'npc',       subtype: 'merchant', label: 'NPC: Merchant',   color: '#f5c842', icon: 'N', defaultConfig: { shopId: '' } },
  { type: 'enemy',     subtype: 'slime',    label: 'Enemy: Slime',    color: '#e74c3c', icon: 'E', defaultConfig: { level: 1 } },
  { type: 'enemy',     subtype: 'skeleton', label: 'Enemy: Skeleton', color: '#c0392b', icon: 'E', defaultConfig: { level: 2 } },
  { type: 'spawn',     subtype: 'player',   label: 'Spawn Point',     color: '#3498db', icon: 'S', defaultConfig: {} },
  { type: 'structure', subtype: 'bridge',   label: 'Bridge',          color: '#a07840', icon: 'B', defaultConfig: { orientation: 'ew', length: '3' } },
  { type: 'structure', subtype: 'dock',     label: 'Dock',            color: '#8b6030', icon: 'D', defaultConfig: { orientation: 'south', length: '3' } },
  { type: 'structure', subtype: 'pier',       label: 'Pier',            color: '#7a5028', icon: 'P', defaultConfig: { orientation: 'south', length: '5' } },
  { type: 'transition', subtype: 'ladder_up',   label: 'Ladder Up',       color: '#a89050', icon: 'L', defaultConfig: { targetZone: '' } },
  { type: 'transition', subtype: 'ladder_down', label: 'Ladder Down',     color: '#806830', icon: 'L', defaultConfig: { targetZone: '' } },
  { type: 'transition', subtype: 'cave_entrance', label: 'Cave Entrance', color: '#58504a', icon: 'C', defaultConfig: { targetZone: '' } },
  { type: 'marker',     subtype: 'generic',    label: 'Room Marker',     color: '#9b59b6', icon: 'M', defaultConfig: { label: '', color: '#9b59b6' } },
  { type: 'container',  subtype: 'chest',      label: 'Container: Chest',  color: '#c8a810', icon: '▣', defaultConfig: { lootTableId: 'basic_chest',  opened: false, contents: [] } },
  { type: 'container',  subtype: 'barrel',     label: 'Container: Barrel', color: '#7a4a2a', icon: '▣', defaultConfig: { lootTableId: 'barrel',       opened: false, contents: [] } },
  { type: 'container',  subtype: 'crate',      label: 'Container: Crate',  color: '#8b5a2b', icon: '▣', defaultConfig: { lootTableId: 'crate',        opened: false, contents: [] } },
];

// ── Surface overlay definitions ───────────────────────────────────────────────
// zone.surface = { "col,row": ["sand","moss",...] }
const SURFACE_TYPES = {
  sand:        { label: 'Sand',        color: 'rgba(210,185,110,0.38)' },
  moss:        { label: 'Moss',        color: 'rgba(80,120,50,0.40)'   },
  grass_patch: { label: 'Grass Patch', color: 'rgba(60,140,60,0.35)'   },
  cracks:      { label: 'Cracks',      color: 'rgba(60,50,40,0.42)'    },
  mud:         { label: 'Mud',         color: 'rgba(100,70,40,0.40)'   },
  snow:        { label: 'Snow',        color: 'rgba(220,235,255,0.50)' },
};

// ── Water flow helper ──────────────────────────────────────────────────────────
// Ensures zone.waterFlow exists and matches tile dimensions.
function ensureWaterFlow(zone, rows, cols) {
  const wf = zone.waterFlow;
  if (wf && wf.length === rows && (wf[0]?.length ?? 0) === cols) return wf;
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

const FACING_OPTIONS = ['north', 'south', 'east', 'west'];

function getEntityDef(entity) {
  return ENTITY_PALETTE.find(d => d.type === entity.type && d.subtype === entity.subtype)
    ?? { color: '#9b59b6', icon: '?' };
}

// ── Camera helpers ─────────────────────────────────────────────────────────────
function getInitialCamera(zone, canvasW, canvasH) {
  const rows = zone.tiles.length;
  const cols = zone.tiles[0].length;
  const corners = [
    gridToScreen(0,      0,      ISO_ORIGIN, TW, TH),
    gridToScreen(0,      cols-1, ISO_ORIGIN, TW, TH),
    gridToScreen(rows-1, 0,      ISO_ORIGIN, TW, TH),
    gridToScreen(rows-1, cols-1, ISO_ORIGIN, TW, TH),
  ];
  const minX = Math.min(...corners.map(c => c.x)) - TW;
  const maxX = Math.max(...corners.map(c => c.x)) + TW;
  const minY = Math.min(...corners.map(c => c.y)) - TH * 4;
  const maxY = Math.max(...corners.map(c => c.y)) + TH * 2;
  const zoom = Math.min((canvasW * 0.88) / (maxX - minX), (canvasH * 0.88) / (maxY - minY), 2);
  return {
    zoom,
    panX: canvasW / 2 - ((minX + maxX) / 2) * zoom,
    panY: canvasH / 2 - ((minY + maxY) / 2) * zoom,
  };
}

// ── Entity hit-test (screen space) ────────────────────────────────────────────
function entityHitTest(mouseX, mouseY, zone, camera) {
  if (!zone?.entities?.length) return null;
  const { panX, panY, zoom } = camera;
  const rows  = zone.tiles.length;
  const cols  = zone.tiles[0].length;
  const HIT_R = 13;
  for (const entity of zone.entities) {
    const grid = worldToGrid(entity.position.x, entity.position.y, rows, cols);
    const { x: wx, y: wy } = gridToScreen(grid.row, grid.col, ISO_ORIGIN, TW, TH);
    const sx = wx * zoom + panX;
    const sy = (wy + TH / 2) * zoom + panY;
    if (Math.hypot(mouseX - sx, mouseY - sy) <= HIT_R) return entity;
  }
  return null;
}

// ── Flood fill ────────────────────────────────────────────────────────────────
// Returns a new tile grid or null if nothing would change.
function floodFill(tiles, startRow, startCol, fillType) {
  const rows   = tiles.length;
  const cols   = tiles[0].length;
  const target = tiles[startRow][startCol];
  if (target === fillType) return null;
  const next    = tiles.map(r => [...r]);
  const stack   = [[startRow, startCol]];
  const visited = new Set();
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    const key = r * cols + c;
    if (visited.has(key)) continue;
    if (next[r][c] !== target) continue;
    visited.add(key);
    next[r][c] = fillType;
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return next;
}

// ── Brush application (paint/erase with size) ─────────────────────────────────
// Returns a new tile grid or null if nothing would change.
function applyBrush(tiles, row, col, tileType, brushSize) {
  const rows   = tiles.length;
  const cols   = tiles[0].length;
  const radius = Math.floor(brushSize / 2);
  let   changed = false;
  const next   = tiles.map(r => [...r]);
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      if (next[r][c] !== tileType) { next[r][c] = tileType; changed = true; }
    }
  }
  return changed ? next : null;
}

// ── Shadow quadrant overlay ───────────────────────────────────────────────────
// Draws a darkening gradient over one quadrant of a tile's top diamond face,
// simulating shadow cast by a higher neighbor along that edge.
// dir: 0 = top-right edge (uphill at r-1,c), 3 = top-left edge (uphill at r,c-1)

function drawShadowQuadrant(ctx, sx, sy, TW, TH, dir, opacity) {
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

  const grad = ctx.createLinearGradient(edgeMidX, edgeMidY, center[0], center[1]);
  grad.addColorStop(0,    `rgba(0,0,0,${opacity.toFixed(3)})`);
  grad.addColorStop(0.65, `rgba(0,0,0,${(opacity * 0.18).toFixed(3)})`);
  grad.addColorStop(1,    'rgba(0,0,0,0)');

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

// ── Canvas draw ───────────────────────────────────────────────────────────────
//
//  overlayOpts: { refImage, refOpacity, refVisible, showGrid, debugMode,
//                 heights, showHeightDebug, waterFlow, animOffset }
//
//  Draw order (back → front) — world space block:
//    1. Tiles (terrain/water/legacy) — painter's order with height
//    2. Waterfall faces              — overlaid on higher water side faces
//    3. Splash effects               — drawn after all tiles (on top)
//    4. Structures                   — bridges, docks, piers above water
//    5. Reference image overlay
//    6. Grid lines
//  Screen space:
//    7. Hover diamond
//    8. Entity markers (NPC/enemy/spawn)

// ── Sorted cell list (painter's algorithm order) ──────────────────────────────
// Height-aware painter's algorithm sort:
// tiles at the same (r+c) diagonal are ordered by elevation (lower first)
// so taller tiles always paint over shorter tiles on the same diagonal.
// Call once when tiles/heights change; reuse the result every frame.
function computeSortedCells(tiles, heights) {
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (tiles[r][c] !== 0) cells.push([r, c]);
  cells.sort((a, b) => {
    const ha = getH(heights, a[0], a[1]);
    const hb = getH(heights, b[0], b[1]);
    return (a[0] + a[1]) * (MAX_HEIGHT + 1) + ha
         - (b[0] + b[1]) * (MAX_HEIGHT + 1) - hb;
  });
  return cells;
}

function drawMapCanvas(canvas, zone, hoveredTile, camera, config, selectedEntityId, editorMode, overlayOpts) {
  const {
    refImage = null, refOpacity = 0.4, refVisible = false,
    showGrid = false, debugMode = false,
    heights = null, showHeightDebug = false,
    waterFlow = null, animOffset = 0,
    waterMod = null, zoneType = 'surface',
    props = null, surface = null, showProps = true,
    ghostProp = null,
    ghostPrefab = null,
    selectedPropId = null,
    showPropBounds = false,
    fovSet = null, showFOV = false,
    showSurface = true,
    // Lighting
    lights = null, enableLighting = false, darkAlpha = 0.78,
    showLightRadius = false,
    // Interior cutaway
    enableCutaway = false, cutawayTransition = 0, playerScreenY = 0,
    showInteriorZones = false, interiorTiles = null,
    // Lighting authoring overlay
    selectedLightId = null, showLightMarkers = false,
    // Tile variation
    tileVariation = true,
    // Pre-sorted cell list (avoids O(n log n) sort every frame)
    sortedCells = null,
  } = overlayOpts ?? {};
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  if (!zone) {
    ctx.fillStyle    = P.muted;
    ctx.font         = '11px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SELECT A MAP OR CREATE A NEW ONE', W / 2, H / 2);
    return;
  }

  const { panX, panY, zoom } = camera;
  const { tiles }            = zone;
  const rows                 = tiles.length;
  const cols                 = tiles[0]?.length ?? 0;
  if (!rows || !cols) return { tilesRendered: 0, propsRendered: 0, lightsRendered: 0 };

  // Perf counters
  let _tilesRendered = 0;
  let _propsRendered = 0;

  // Use pre-sorted list when available (cached by useEffect); fall back to
  // computing it here (e.g. first frame before the effect fires).
  const cells = sortedCells ?? computeSortedCells(tiles, heights);

  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);

  // ── 1. Tiles ─────────────────────────────────────────────────────────────────
  const splashList = []; // collected during tile loop, drawn in pass 3

  // Viewport cull constants (screen-space, computed once per frame)
  const _cullHalfW = (TW / 2) * zoom;                          // tile half-width in px
  const _cullMaxH  = (TH + MAX_HEIGHT * HEIGHT_SCALE) * zoom;  // max tile body height in px
  const _cullPad   = 100;                                       // extra margin around viewport

  for (const [r, c] of cells) {
    const type   = tiles[r][c];
    const h      = getH(heights, r, c);
    const { x: sx, y: syBase } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
    const sy     = syBase - h * HEIGHT_SCALE;

    // ── Viewport cull — skip tiles completely outside the canvas ────────────
    const screenX = sx  * zoom + panX;
    const screenY = sy  * zoom + panY;
    if (screenX + _cullHalfW  < -_cullPad || screenX - _cullHalfW  > W + _cullPad ||
        screenY + _cullMaxH   < -_cullPad || screenY               > H + _cullPad) {
      continue;
    }

    _tilesRendered++;
    const cliffR = Math.max(0, h - getH(heights, r,     c + 1)) * HEIGHT_SCALE;
    const cliffL = Math.max(0, h - getH(heights, r + 1, c    )) * HEIGHT_SCALE;

    // Cutaway: fade front-facing wall tiles when player is inside a building
    let tileAlpha = 1.0;
    if (enableCutaway && cutawayTransition > 0.05) {
      const tsY = (syBase - 0) * zoom + (camera?.panY ?? 0); // tile top-vertex screen Y
      tileAlpha = getCutawayAlpha(type, syBase, playerScreenY / (camera?.zoom ?? 1) - (camera?.panY ?? 0) / (camera?.zoom ?? 1), cutawayTransition);
    }
    const prevAlpha = tileAlpha < 0.999 ? ctx.globalAlpha : null;
    if (prevAlpha !== null) ctx.globalAlpha = tileAlpha;

    if (isWaterTile(type)) {
      drawWaterTile(ctx, sx, sy, TW, TH, r, c, tiles, heights, waterFlow,
                    animOffset, cliffR, cliffL, waterMod);
      // ── Waterfall detection (right face: toward col+1)
      if (c + 1 < cols && isWaterTile(tiles[r][c + 1])) {
        const hR = getH(heights, r, c + 1);
        if (h > hR) {
          drawWaterfallFace(ctx, sx, sy, TW, TH, 'right', h - hR, r, c, animOffset);
          splashList.push({ row: r, col: c + 1, h: hR });
        }
      }
      // ── Waterfall detection (left face: toward row+1)
      if (r + 1 < rows && isWaterTile(tiles[r + 1][c])) {
        const hL = getH(heights, r + 1, c);
        if (h > hL) {
          drawWaterfallFace(ctx, sx, sy, TW, TH, 'left', h - hL, r, c, animOffset);
          splashList.push({ row: r + 1, col: c, h: hL });
        }
      }
    } else if (isTerrainTile(type)) {
      drawTerrainTile(ctx, sx, sy, TW, TH, type, r, c, tiles, debugMode, h, cliffR, cliffL);
    } else {
      const tColor = applyHeightBrightness(pickTileColor(type, r, c, tiles, config), h);
      drawIsoTile(ctx, sx, sy, TW, TH, tColor, type, config, cliffR, cliffL);
      // Per-tile brightness variation — breaks the uniform grid look
      if (tileVariation && !debugMode) {
        const vf = tileHash(r, c);
        const shift = (vf - 0.5) * 0.13; // ±0.065 alpha overlay
        if (Math.abs(shift) > 0.008) {
          ctx.save();
          ctx.globalAlpha = Math.abs(shift);
          ctx.fillStyle   = shift > 0 ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
          ctx.beginPath();
          ctx.moveTo(sx,          sy);
          ctx.lineTo(sx + TW / 2, sy + TH / 2);
          ctx.lineTo(sx,          sy + TH);
          ctx.lineTo(sx - TW / 2, sy + TH / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Height-based shadow from uphill neighbours (all tile types)
    if (r > 0) {
      const diff = getH(heights, r - 1, c) - h;
      if (diff > 0) drawShadowQuadrant(ctx, sx, sy, TW, TH, 0, shadowOpacity(diff));
    }
    if (c > 0) {
      const diff = getH(heights, r, c - 1) - h;
      if (diff > 0) drawShadowQuadrant(ctx, sx, sy, TW, TH, 3, shadowOpacity(diff));
    }

    // Restore tile alpha
    if (prevAlpha !== null) ctx.globalAlpha = prevAlpha;

    // Height debug overlay
    if (showHeightDebug && h > 0) {
      const numSize = Math.max(7, Math.round(TH * 0.38));
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.font         = `bold ${numSize}px monospace`;
      ctx.strokeStyle  = 'rgba(0,0,0,0.6)';
      ctx.lineWidth    = 2.5;
      ctx.strokeText(String(h), sx, sy + TH * 0.5);
      ctx.fillStyle    = 'rgba(255,255,255,0.82)';
      ctx.fillText(String(h), sx, sy + TH * 0.5);
      ctx.restore();
    }
  }

  // ── 2. Splash effects (on top of all tiles) ───────────────────────────────────
  for (const { row, col, h } of splashList) {
    const { x: sx, y: syBase } = gridToScreen(row, col, ISO_ORIGIN, TW, TH);
    const sy = syBase - h * HEIGHT_SCALE;
    drawSplashEffect(ctx, sx, sy, TW, TH, row, col, animOffset);
  }

  // ── 2b. Surface overlays (painted on top of tiles, below props) ───────────────
  if (showSurface && surface) {
    for (const [key, types] of Object.entries(surface)) {
      const [c, r] = key.split(',').map(Number);
      if (r < 0 || r >= rows || c < 0 || c >= cols || tiles[r][c] === 0) continue;
      const h = getH(heights, r, c);
      const { x: sx, y: syBase } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
      const sy  = syBase - h * HEIGHT_SCALE;
      const hw  = TW * 0.5, hh = TH * 0.5;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + hw, sy + hh);
      ctx.lineTo(sx, sy + TH);
      ctx.lineTo(sx - hw, sy + hh);
      ctx.closePath();
      ctx.clip();
      for (const stype of (Array.isArray(types) ? types : [types])) {
        const def = SURFACE_TYPES[stype];
        if (!def) continue;
        ctx.fillStyle = def.color;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── 3. Structures (bridges, docks, piers) ─────────────────────────────────────
  const structures = (zone.entities ?? []).filter(e => e.type === 'structure');
  for (const entity of structures) {
    const grid = worldToGrid(entity.position.x, entity.position.y, rows, cols);

    if (entity.subtype === 'bridge') {
      const ori  = entity.config?.orientation ?? 'ew';
      const len  = Math.max(1, parseInt(entity.config?.length ?? 3));
      const half = Math.floor(len / 2);
      for (let i = -half; i < len - half; i++) {
        const br = ori === 'ns' ? grid.row + i : grid.row;
        const bc = ori === 'ew' ? grid.col + i : grid.col;
        if (br < 0 || br >= rows || bc < 0 || bc >= cols) continue;
        const bh = getH(heights, br, bc);
        const { x: bsx, y: bsyBase } = gridToScreen(br, bc, ISO_ORIGIN, TW, TH);
        drawBridgeSegment(ctx, bsx, bsyBase - bh * HEIGHT_SCALE, TW, TH, ori, br, bc);
      }
    }

    if (entity.subtype === 'dock' || entity.subtype === 'pier') {
      const ori       = entity.config?.orientation ?? 'south';
      const len       = Math.max(1, parseInt(entity.config?.length ?? 3));
      const [dr, dc]  = DOCK_DIR_DELTAS[ori] ?? [1, 0];
      for (let i = 0; i <= len; i++) {
        const dr_ = grid.row + dr * i;
        const dc_ = grid.col + dc * i;
        if (dr_ < 0 || dr_ >= rows || dc_ < 0 || dc_ >= cols) break;
        const dh = getH(heights, dr_, dc_);
        const { x: dsx, y: dsyBase } = gridToScreen(dr_, dc_, ISO_ORIGIN, TW, TH);
        drawDockSegment(ctx, dsx, dsyBase - dh * HEIGHT_SCALE, TW, TH, ori,
                        i === 0, i === len ? 'tip' : i, dr_, dc_);
      }
    }
  }

  // ── 3b. Props (sorted by depth, back-to-front) ────────────────────────────────
  if (showProps && props?.length) {
    const sorted = [...props].sort((a, b) => propSortKey(a) - propSortKey(b));
    for (const prop of sorted) {
      _propsRendered++;
      const h = getH(heights, prop.y, prop.x);
      const { x: sx, y: syBase } = gridToScreen(prop.y, prop.x, ISO_ORIGIN, TW, TH);
      const sy  = syBase - h * HEIGHT_SCALE;
      const def = PROP_DEFS[prop.type];
      const wallDir = def?.anchor === 'wall' ? detectWallDirection(prop.x, prop.y, tiles) : null;
      const isSelected = prop.id === selectedPropId;
      if (isSelected) {
        // Selection ring
        const cx = sx, cy = sy + TH * 0.5;
        ctx.save();
        ctx.strokeStyle = P.accent;
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, TW * 0.30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      if (showPropBounds && def) {
        const { x: ex, y: ey } = gridToScreen(prop.y + (def.height ?? 1) - 1, prop.x + (def.width ?? 1) - 1, ISO_ORIGIN, TW, TH);
        ctx.save();
        ctx.strokeStyle = 'rgba(0,212,255,0.45)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(Math.min(sx, ex) - TW * 0.5, sy, Math.abs(ex - sx) + TW, Math.abs(ey - sy) + TH);
        ctx.setLineDash([]);
        ctx.restore();
      }
      drawProp(ctx, sx, sy, TW, TH, prop, wallDir, 'horizontal');
    }
  }

  // ── 3c. Ghost prop preview (placement overlay) ────────────────────────────────
  if (ghostProp && ghostProp.x !== undefined) {
    const { type, x, y, valid } = ghostProp;
    const h = getH(heights, y, x);
    const { x: sx, y: syBase } = gridToScreen(y, x, ISO_ORIGIN, TW, TH);
    const sy     = syBase - h * HEIGHT_SCALE;
    const def    = PROP_DEFS[type];
    const wallDir = def?.anchor === 'wall' ? detectWallDirection(x, y, tiles) : null;
    // Footprint tint
    const fpW = def?.width ?? 1, fpH = def?.height ?? 1;
    for (let dy = 0; dy < fpH; dy++) {
      for (let dx = 0; dx < fpW; dx++) {
        const { x: fx, y: fyBase } = gridToScreen(y + dy, x + dx, ISO_ORIGIN, TW, TH);
        const fy  = fyBase - h * HEIGHT_SCALE;
        const hw  = TW * 0.5, hh = TH * 0.5;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + hw, fy + hh);
        ctx.lineTo(fx, fy + TH);
        ctx.lineTo(fx - hw, fy + hh);
        ctx.closePath();
        ctx.fillStyle = valid ? 'rgba(0,212,255,0.15)' : 'rgba(255,60,60,0.25)';
        ctx.fill();
        ctx.strokeStyle = valid ? 'rgba(0,212,255,0.5)' : 'rgba(255,60,60,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
    drawProp(ctx, sx, sy, TW, TH,
      { type, x, y, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
      wallDir, 'horizontal', 0.55);
  }

  // ── 3d. Ghost prefab preview ──────────────────────────────────────────────────
  if (ghostPrefab && ghostPrefab.prefab) {
    const { prefab, x: px, y: py, valid } = ghostPrefab;
    for (let dy = 0; dy < prefab.height; dy++) {
      for (let dx = 0; dx < prefab.width; dx++) {
        const tv = prefab.tiles[dy]?.[dx] ?? 0;
        if (!tv) continue;
        const gx = px + dx, gy = py + dy;
        const h  = getH(heights, gy, gx);
        const { x: fx, y: fyBase } = gridToScreen(gy, gx, ISO_ORIGIN, TW, TH);
        const fy  = fyBase - h * HEIGHT_SCALE;
        const hw  = TW * 0.5, hh = TH * 0.5;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + hw, fy + hh);
        ctx.lineTo(fx, fy + TH);
        ctx.lineTo(fx - hw, fy + hh);
        ctx.closePath();
        ctx.fillStyle = valid ? 'rgba(0,255,150,0.18)' : 'rgba(255,60,60,0.22)';
        ctx.fill();
        ctx.strokeStyle = valid ? 'rgba(0,255,150,0.55)' : 'rgba(255,60,60,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ── 2. Reference image overlay ────────────────────────────────────────────────
  if (refImage && refVisible) {
    const corners = [
      gridToScreen(0,      0,      ISO_ORIGIN, TW, TH),
      gridToScreen(0,      cols-1, ISO_ORIGIN, TW, TH),
      gridToScreen(rows-1, 0,      ISO_ORIGIN, TW, TH),
      gridToScreen(rows-1, cols-1, ISO_ORIGIN, TW, TH),
    ];
    const imgX = Math.min(...corners.map(p => p.x)) - TW * 0.5;
    const imgY = Math.min(...corners.map(p => p.y)) - TH * 0.5;
    const imgW = Math.max(...corners.map(p => p.x)) - imgX + TW * 0.5;
    const imgH = Math.max(...corners.map(p => p.y)) - imgY + TH;
    ctx.globalAlpha = refOpacity;
    ctx.drawImage(refImage, imgX, imgY, imgW, imgH);
    ctx.globalAlpha = 1;
  }

  // ── 3. Grid overlay ───────────────────────────────────────────────────────────
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth   = 1 / zoom;
    for (const [r, c] of cells) {
      const h = getH(heights, r, c);
      const { x, y: yBase } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
      const y = yBase - h * HEIGHT_SCALE;
      ctx.beginPath();
      ctx.moveTo(x,          y);
      ctx.lineTo(x + TW / 2, y + TH / 2);
      ctx.lineTo(x,          y + TH);
      ctx.lineTo(x - TW / 2, y + TH / 2);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // ── 4. Zone environment tint (world-space, on top of all tiles) ───────────────
  {
    const envCfg = ZONE_ENV[zoneType];
    if (envCfg?.tileTint) {
      const corners = [
        gridToScreen(0,      0,      ISO_ORIGIN, TW, TH),
        gridToScreen(0,      cols-1, ISO_ORIGIN, TW, TH),
        gridToScreen(rows-1, 0,      ISO_ORIGIN, TW, TH),
        gridToScreen(rows-1, cols-1, ISO_ORIGIN, TW, TH),
      ];
      const minX = Math.min(...corners.map(p => p.x)) - TW;
      const minY = Math.min(...corners.map(p => p.y)) - TH;
      const spanW = Math.max(...corners.map(p => p.x)) - minX + TW;
      const spanH = Math.max(...corners.map(p => p.y)) - minY + TH * 2;
      drawEnvTint(ctx, envCfg.tileTint, minX, minY, spanW, spanH);
    }
  }

  ctx.restore();

  // ── 5. Zone vignette (screen-space) ──────────────────────────────────────────
  {
    const envCfg = ZONE_ENV[zoneType];
    if (envCfg?.vignette) drawVignette(ctx, W, H, envCfg.vignette);
  }

  // ── 6. Lighting pass (darkness + radial lights, screen-space) ────────────────
  if (enableLighting && lights?.length >= 0) {
    drawLightingPass(
      ctx, W, H,
      lights ?? [], tiles, camera,
      gridToScreen, ISO_ORIGIN, TW, TH,
      heights, HEIGHT_SCALE,
      darkAlpha,
      showFOV ? fovSet : null,   // only mask by FOV when FOV debug is on
      null,                       // exploredSet — not tracked in editor yet
      showLightRadius,
    );
  }

  // ── 7. Interior zone debug overlay ────────────────────────────────────────────
  if (showInteriorZones && interiorTiles?.size) {
    drawInteriorZoneOverlay(
      ctx, interiorTiles, tiles, camera,
      gridToScreen, ISO_ORIGIN, TW, TH, heights, HEIGHT_SCALE,
    );
  }

  // ── 8. FOV debug overlay (screen-space) ───────────────────────────────────────
  if (showFOV && fovSet) {
    drawFOVOverlay(ctx, fovSet, tiles, ISO_ORIGIN, TW, TH, camera, gridToScreen);
  }

  // ── 4. Hover diamond (screen space) ───────────────────────────────────────────
  if (hoveredTile) {
    const { row, col } = hoveredTile;
    const h = getH(heights, row, col);
    const { x: wx, y: wyBase } = gridToScreen(row, col, ISO_ORIGIN, TW, TH);
    const wy  = wyBase - h * HEIGHT_SCALE;
    const sx  = wx  * zoom + panX;
    const sy  = wy  * zoom + panY;
    const sHW = TW  * zoom * 0.5;
    const sHH = TH  * zoom * 0.5;
    const sTH = TH  * zoom;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx,       sy);
    ctx.lineTo(sx - sHW, sy + sHH);
    ctx.lineTo(sx,       sy + sTH);
    ctx.lineTo(sx + sHW, sy + sHH);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(0, 212, 255, 0.18)';
    ctx.fill();
    ctx.strokeStyle = P.accent;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Height indicator label in height mode
    if (editorMode === 'height' && h > 0) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font         = '9px monospace';
      ctx.fillStyle    = P.accent;
      ctx.fillText(`h:${h}`, sx, sy - 3);
    }
    ctx.restore();
  }

  // ── 5. Entity markers (screen space) ──────────────────────────────────────────
  const entities = zone.entities ?? [];
  if (!entities.length) return;

  const MARKER_R = 9;
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 9px monospace';

  for (const entity of entities) {
    if (entity.type === 'structure') continue; // rendered in world-space pass above
    const grid = worldToGrid(entity.position.x, entity.position.y, rows, cols);
    const h    = getH(heights, grid.row, grid.col);
    const { x: wx, y: wyBase } = gridToScreen(grid.row, grid.col, ISO_ORIGIN, TW, TH);
    const wy  = wyBase - h * HEIGHT_SCALE;
    const sx  = wx  * zoom + panX;
    const sy  = (wy + TH / 2) * zoom + panY;
    const isSelected = entity.id === selectedEntityId;

    // Room type markers (from questGen) — render as a color-coded label badge
    if (entity.type === 'marker') {
      const color  = entity.config?.color ?? '#9b59b6';
      const label  = entity.config?.label ?? 'MKR';
      ctx.save();
      ctx.globalAlpha = 0.78;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.roundRect?.(sx - 14, sy - 8, 28, 16, 3) ?? ctx.rect(sx - 14, sy - 8, 28, 16);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.font         = 'bold 8px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx, sy);
      ctx.globalAlpha = 1;
      if (isSelected) {
        ctx.strokeStyle = P.accent;
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(sx - 15, sy - 9, 30, 18);
      }
      ctx.restore();
      continue;
    }

    const def = getEntityDef(entity);

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(sx, sy, MARKER_R + 5, 0, Math.PI * 2);
      ctx.strokeStyle = P.accent;
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(sx + 1, sy + 1, MARKER_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, MARKER_R, 0, Math.PI * 2);
    ctx.fillStyle   = def.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(def.icon ?? '?', sx, sy);
  }
  ctx.restore();

  // ── 6. Light authoring markers (screen space, lighting editor mode) ───────────
  if (showLightMarkers && zone?.lights?.length) {
    ctx.save();
    for (const light of zone.lights) {
      const h = getH(heights, light.y, light.x);
      const { x: wx, y: wyBase } = gridToScreen(light.y, light.x, ISO_ORIGIN, TW, TH);
      const wy = wyBase - h * HEIGHT_SCALE;
      const sx = wx * zoom + panX;
      const sy = (wy + TH * 0.5) * zoom + panY;
      const isSelected = light.id === selectedLightId;
      const col = typeof light.color === 'object'
        ? light.color
        : { r: 255, g: 178, b: 75 };
      const { r, g, b } = col;

      // Soft glow halo
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 20);
      gr.addColorStop(0,   `rgba(${r},${g},${b},0.55)`);
      gr.addColorStop(0.5, `rgba(${r},${g},${b},0.18)`);
      gr.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(sx, sy, 20, 0, Math.PI * 2);
      ctx.fill();

      // Marker disc
      ctx.beginPath();
      ctx.arc(sx + 1, sy + 1, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth   = isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // Light type letter
      ctx.fillStyle    = 'rgba(0,0,0,0.8)';
      ctx.font         = 'bold 7px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((light.type ?? 'T').charAt(0).toUpperCase(), sx, sy);

      // Selected: radius preview ring + property badge
      if (isSelected) {
        const rPx = (light.radius ?? 150) * zoom;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label
        ctx.fillStyle    = `rgba(${r},${g},${b},0.9)`;
        ctx.font         = '8px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${light.type}  r${light.radius ?? 150}`, sx, sy - 11);
      }
    }
    ctx.restore();
  }

  return {
    tilesRendered:  _tilesRendered,
    propsRendered:  _propsRendered,
    lightsRendered: (lights ?? []).length,
  };
}

// ── Local UI helpers ──────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        fontSize: 10, color: P.accent, letterSpacing: 4,
        borderBottom: `1px solid ${P.border}`, paddingBottom: 6,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, labelWidth = 52, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: P.muted, letterSpacing: 1, width: labelWidth, flexShrink: 0 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const inputStyle = {
  background: P.bg, border: `1px solid ${P.border}`, color: P.text,
  fontFamily: 'monospace', fontSize: 11, padding: '4px 7px', width: '100%',
};

const selectStyle = { ...inputStyle, padding: '3px 6px', cursor: 'pointer' };

const toolbarBtnStyle = {
  background: 'rgba(0,0,0,0.55)', border: `1px solid ${P.border}`,
  color: P.muted, fontFamily: 'monospace', fontSize: 9, letterSpacing: 2,
  padding: '4px 10px', cursor: 'pointer',
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function MapEditorTab({ config }) {

  // ── Map state ────────────────────────────────────────────────────────────────
  const [zoneList,     setZoneList]     = useState([]);
  const [zone,         setZone]         = useState(null);
  const [currentMapId, setCurrentMapId] = useState(null);
  const [isDirty,      setIsDirty]      = useState(false);
  const [loadError,    setLoadError]    = useState(null);

  // ── Camera ───────────────────────────────────────────────────────────────────
  const [camera, setCamera] = useState({ panX: 0, panY: 0, zoom: 1 });

  // ── Editor mode ──────────────────────────────────────────────────────────────
  const [editorMode, setEditorMode] = useState('tile'); // 'tile' | 'height' | 'entity' | 'generate'

  // ── Procedural generation ─────────────────────────────────────────────────────
  const [genMode, setGenMode] = useState('cave'); // 'cave' | 'dungeon'
  const [caveParams, setCaveParams] = useState({
    width: 60, height: 60, fillPercent: 46, smoothSteps: 5,
    seed: 12345, waterFraction: 8,
  });
  const [dungeonParams, setDungeonParams] = useState({
    width: 60, height: 60, roomCount: 12, minRoomSize: 4,
    maxRoomSize: 10, seed: 12345,
  });

  // ── Prop mode ─────────────────────────────────────────────────────────────────
  const [propCategory,    setPropCategory]    = useState('forest');
  const [activePropType,  setActivePropType]  = useState('tree_small');
  const [selectedPropId,  setSelectedPropId]  = useState(null);
  const [showProps,       setShowProps]       = useState(true);
  const [showPropBounds,  setShowPropBounds]  = useState(false);
  const [ghostPropTile,   setGhostPropTile]   = useState(null); // {x,y,valid} or null

  // ── Surface mode ──────────────────────────────────────────────────────────────
  const [activeSurface,   setActiveSurface]   = useState('sand');
  const [surfaceBrushSize, setSurfaceBrushSize] = useState(1);
  const [showSurface,     setShowSurface]     = useState(true);
  const [isPaintingSurface, setIsPaintingSurface] = useState(false);

  // ── Prefab mode ───────────────────────────────────────────────────────────────
  const [activePrefab,    setActivePrefab]    = useState(Object.keys(PREFABS)[0]);
  const [prefabRotation,  setPrefabRotation]  = useState(0);  // 0|1|2|3
  const [prefabStampMode, setPrefabStampMode] = useState('stamp'); // 'stamp'|'merge'
  const [ghostPrefabTile, setGhostPrefabTile] = useState(null);

  // ── FOV debug ─────────────────────────────────────────────────────────────────
  const [showFOV,   setShowFOV]   = useState(false);
  const [fovOrigin, setFovOrigin] = useState(null); // {x,y} grid cell
  const [fovRadius, setFovRadius] = useState(10);

  // ── Lighting ──────────────────────────────────────────────────────────────────
  const [enableLighting,   setEnableLighting]   = useState(false);
  const [showLightRadius,  setShowLightRadius]  = useState(false);
  // darkAlpha auto-derived from interior transition when lighting is on

  // ── Interior cutaway ──────────────────────────────────────────────────────────
  const [enableCutaway,    setEnableCutaway]    = useState(false);
  const [showInteriorZones,setShowInteriorZones]= useState(false);
  // cutawayTransition smoothly lerps in RAF loop via ref
  const cutawayTransitionRef = useRef(0);

  // ── Loot popup ────────────────────────────────────────────────────────────────
  const [lootPopup, setLootPopup] = useState(null); // { entityId, title, lines[] }

  // ── Performance debug ─────────────────────────────────────────────────────────
  const [perfDebug, setPerfDebug] = useState(false);

  // ── Lighting authoring ────────────────────────────────────────────────────────
  const [activeLightType,   setActiveLightType]   = useState('torch');
  const [selectedLightId,   setSelectedLightId]   = useState(null);
  const [activeLightPreset, setActiveLightPreset] = useState('tavern_warm');
  const [showLightMarkers,  setShowLightMarkers]  = useState(true);

  // ── Prop scatter sub-tool ─────────────────────────────────────────────────────
  const [propTool,       setPropTool]      = useState('paint');  // 'paint'|'scatter'
  const [scatterDensity, setScatterDensity] = useState(0.35);
  const [scatterRadius,  setScatterRadius]  = useState(5);
  const [isScattering,   setIsScattering]  = useState(false);

  // ── Tile variation ────────────────────────────────────────────────────────────
  const [tileVariation, setTileVariation] = useState(true);

  // ── Interior tiles cache ──────────────────────────────────────────────────────
  const interiorTilesRef = useRef(new Set());

  // ── Tile mode ────────────────────────────────────────────────────────────────
  const [selectedTileType, setSelectedTileType] = useState(TILE_TYPES.FLOOR);
  const [hoveredTile,      setHovered]          = useState(null);
  const [isPainting,       setIsPainting]       = useState(false);

  // ── Brush tools ──────────────────────────────────────────────────────────────
  const [brushTool, setBrushTool] = useState('paint'); // 'paint' | 'erase' | 'fill'
  const [brushSize, setBrushSize] = useState(1);       // 1 | 3 | 5

  // ── Entity mode ──────────────────────────────────────────────────────────────
  const [selectedEntityDef, setSelectedEntityDef] = useState(ENTITY_PALETTE[0]);
  const [selectedEntityId,  setSelectedEntityId]  = useState(null);

  // ── Overlay / view ───────────────────────────────────────────────────────────
  const [showGrid,        setShowGrid]        = useState(false);
  const [debugMode,       setDebugMode]       = useState(false); // raw flat-color view
  const [refImage,        setRefImage]        = useState(null);  // HTMLImageElement | null
  const [refOpacity,      setRefOpacity]      = useState(0.4);
  const [refVisible,      setRefVisible]      = useState(true);
  const [showHeightDebug,  setShowHeightDebug]  = useState(false); // show h numbers
  const [rotationAngle,    setRotationAngle]    = useState(0);     // 0|1|2|3 (×90°)
  const [selectedFlowDir,  setSelectedFlowDir]  = useState(null);  // null|'north'|'east'|'south'|'west'

  // ── History ──────────────────────────────────────────────────────────────────
  const [historyLen, setHistoryLen] = useState(0);
  const [futureLen,  setFutureLen]  = useState(0);

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const canvasRef        = useRef(null);
  const containerRef     = useRef(null);
  const fileInputRef     = useRef(null);
  const refImageInputRef = useRef(null);
  const isPanningRef     = useRef(false);
  const lastMouseRef     = useRef({ x: 0, y: 0 });
  const historyRef       = useRef([]);  // zone snapshots (deepClone)
  const futureRef        = useRef([]);  // redo snapshots

  // Stable mirrors of reactive values for use inside stable callbacks
  const cameraRef            = useRef(camera);
  const zoneRef              = useRef(zone);
  const editorModeRef        = useRef(editorMode);
  const isPaintingRef        = useRef(isPainting);
  const selectedTileTypeRef  = useRef(selectedTileType);
  const selectedEntityDefRef = useRef(selectedEntityDef);
  const brushToolRef         = useRef(brushTool);
  const brushSizeRef         = useRef(brushSize);
  const heightDeltaRef       = useRef(1);    // +1 raise / -1 lower, set on mousedown
  const rotationAngleRef     = useRef(rotationAngle);
  const selectedFlowDirRef   = useRef(selectedFlowDir);
  const enableLightingRef      = useRef(enableLighting);
  const enableCutawayRef       = useRef(enableCutaway);
  const activePropTypeRef      = useRef(activePropType);
  const activeSurfaceRef       = useRef(activeSurface);
  const surfaceBrushSizeRef    = useRef(surfaceBrushSize);
  const activePrefabRef        = useRef(activePrefab);
  const prefabRotationRef      = useRef(prefabRotation);
  const prefabStampModeRef     = useRef(prefabStampMode);
  const animOffsetRef        = useRef(0);   // ever-increasing time for water animation
  const animRafRef           = useRef(null);
  const drawOptsRef          = useRef(null); // latest draw params for RAF loop
  const frameLightsRef       = useRef([]);  // rebuilt only when zone.props/lights change
  const hasWaterRef          = useRef(false); // cached — avoid per-frame tile scan
  const sortedCellsRef       = useRef([]);  // pre-sorted painter's order — rebuilt on tiles/heights change
  const perfRef              = useRef({ fps: 0, frameTime: 0, tiles: 0, props: 0, lights: 0, slow: false });
  const perfOverlayRef       = useRef(null);
  const fpsHistoryRef        = useRef([]);
  const perfDebugRef         = useRef(false);

  useEffect(() => { cameraRef.current            = camera; },           [camera]);
  useEffect(() => { zoneRef.current              = zone; },             [zone]);
  useEffect(() => { editorModeRef.current        = editorMode; },       [editorMode]);
  useEffect(() => { isPaintingRef.current        = isPainting; },       [isPainting]);
  useEffect(() => { selectedTileTypeRef.current  = selectedTileType; }, [selectedTileType]);
  useEffect(() => { selectedEntityDefRef.current = selectedEntityDef; },[selectedEntityDef]);
  useEffect(() => { brushToolRef.current         = brushTool; },        [brushTool]);
  useEffect(() => { brushSizeRef.current         = brushSize; },        [brushSize]);
  useEffect(() => { rotationAngleRef.current     = rotationAngle; },    [rotationAngle]);
  useEffect(() => { selectedFlowDirRef.current   = selectedFlowDir; },  [selectedFlowDir]);
  useEffect(() => { enableLightingRef.current      = enableLighting; },    [enableLighting]);
  useEffect(() => { enableCutawayRef.current       = enableCutaway; },     [enableCutaway]);
  useEffect(() => { perfDebugRef.current           = perfDebug; },         [perfDebug]);

  // Stable refs for new fields
  const activeLightTypeRef  = useRef(activeLightType);
  const scatterDensityRef   = useRef(scatterDensity);
  const scatterRadiusRef    = useRef(scatterRadius);
  const propToolRef         = useRef(propTool);
  useEffect(() => { activeLightTypeRef.current = activeLightType; }, [activeLightType]);
  useEffect(() => { scatterDensityRef.current  = scatterDensity; },  [scatterDensity]);
  useEffect(() => { scatterRadiusRef.current   = scatterRadius; },   [scatterRadius]);
  useEffect(() => { propToolRef.current        = propTool; },        [propTool]);
  useEffect(() => { activePropTypeRef.current      = activePropType; },     [activePropType]);
  useEffect(() => { activeSurfaceRef.current       = activeSurface; },      [activeSurface]);
  useEffect(() => { surfaceBrushSizeRef.current    = surfaceBrushSize; },   [surfaceBrushSize]);
  useEffect(() => { activePrefabRef.current        = activePrefab; },       [activePrefab]);
  useEffect(() => { prefabRotationRef.current      = prefabRotation; },     [prefabRotation]);
  useEffect(() => { prefabStampModeRef.current     = prefabStampMode; },    [prefabStampMode]);

  // ── Keep draw opts mirror current on every render (for RAF loop) ─────────────
  useLayoutEffect(() => {
    const zoneType   = zone?.type ?? 'surface';
    const fovSet     = (showFOV && fovOrigin && zone?.tiles)
      ? computeFOV(fovOrigin.x, fovOrigin.y, zone.tiles, fovRadius)
      : null;
    const rotatedPrefab = PREFABS[activePrefab] ? rotatePrefab(PREFABS[activePrefab], prefabRotation) : null;
    const ghostProp  = (editorMode === 'props' && ghostPropTile)
      ? { ...ghostPropTile, type: activePropType }
      : null;
    const ghostPrefab = (editorMode === 'prefabs' && ghostPrefabTile && rotatedPrefab)
      ? { prefab: rotatedPrefab, ...ghostPrefabTile }
      : null;
    const trans = cutawayTransitionRef.current;
    const bLight = enableLighting ? getBlendedLightingConfig(trans) : null;
    drawOptsRef.current = {
      zone, hoveredTile, camera, config, selectedEntityId, editorMode,
      overlayOpts: {
        refImage, refOpacity, refVisible, showGrid, debugMode,
        heights:           zone?.heights   ?? null,
        showHeightDebug,
        waterFlow:         zone?.waterFlow ?? null,
        waterMod:          ZONE_ENV[zoneType]?.waterMod ?? null,
        zoneType,
        props:             zone?.props  ?? null,
        surface:           zone?.surface ?? null,
        showProps, showSurface, showPropBounds,
        selectedPropId, ghostProp, ghostPrefab,
        fovSet, showFOV,
        // Lighting
        lights:            enableLighting ? frameLightsRef.current : [],
        enableLighting,
        darkAlpha:         bLight?.darkAlpha ?? 0.78,
        showLightRadius,
        // Cutaway
        enableCutaway,
        cutawayTransition: trans,
        showInteriorZones,
        interiorTiles:     interiorTilesRef.current,
        fovOriginForCutaway: fovOrigin,
        // Lighting authoring
        selectedLightId,
        showLightMarkers:  editorMode === 'lighting' || showLightMarkers,
        // Tile variation
        tileVariation,
      },
    };
  }); // no deps — runs after every render

  // ── Water + lighting animation RAF loop ──────────────────────────────────────
  // Redraws the canvas each frame when: water is present, lighting is on,
  // or cutaway transition is in progress.

  useEffect(() => {
    let lastTime = performance.now();

    const tick = (now) => {
      const dt      = Math.min((now - lastTime) / 1000, 0.05);
      lastTime      = now;
      const lighting = enableLightingRef.current;

      // ── FPS tracking (every frame, not just drawing frames) ──────────────────
      if (perfDebugRef.current && dt > 0) {
        const hist = fpsHistoryRef.current;
        hist.push(Math.min(1 / dt, 999));
        if (hist.length > 60) hist.shift();
      }

      // ── Advance cutaway transition ────────────────────────────────────────────
      let cutawayChanged = false;
      const z = zoneRef.current;
      if (enableCutawayRef.current && z?.tiles) {
        const fovO   = drawOptsRef.current?.overlayOpts?.fovOriginForCutaway;
        const target = fovO ? computeTransitionFactor(fovO.x, fovO.y, interiorTilesRef.current) : 0;
        const cur    = cutawayTransitionRef.current;
        const next   = cur + (target - cur) * Math.min(1, dt * 4.5);
        if (Math.abs(next - cur) > 0.005) {
          cutawayTransitionRef.current = next;
          cutawayChanged = true;
        }
      } else if (cutawayTransitionRef.current > 0.01) {
        cutawayTransitionRef.current *= (1 - dt * 4);
        cutawayChanged = true;
      }

      // ── Tick light flicker (no rebuild — use cached frameLightsRef) ───────────
      if (lighting) tickLights(frameLightsRef.current, now / 1000);

      const needRedraw = hasWaterRef.current || lighting || cutawayChanged;
      if (needRedraw) {
        animOffsetRef.current += dt * 0.35;
        const canvas = canvasRef.current;
        const opts   = drawOptsRef.current;
        if (canvas && opts?.zone) {
          const trans  = cutawayTransitionRef.current;
          const bLight = lighting ? getBlendedLightingConfig(trans) : null;
          const pFov   = opts.overlayOpts?.fovOriginForCutaway;
          let playerScreenY = 0;
          if (pFov && opts.zone?.tiles) {
            const { x: wx, y: wy } = gridToScreen(pFov.y, pFov.x, ISO_ORIGIN, TW, TH);
            const hh_ = getH(opts.overlayOpts?.heights, pFov.y, pFov.x);
            playerScreenY = (wy - hh_ * HEIGHT_SCALE + TH * 0.5) * opts.camera.zoom + opts.camera.panY;
          }

          const drawStart = performance.now();
          const metrics   = drawMapCanvas(
            canvas, opts.zone, opts.hoveredTile, opts.camera, opts.config,
            opts.selectedEntityId, opts.editorMode,
            {
              ...opts.overlayOpts,
              animOffset:        animOffsetRef.current,
              lights:            lighting ? frameLightsRef.current : [],
              enableLighting:    lighting,
              darkAlpha:         bLight?.darkAlpha ?? 0.78,
              showLightRadius:   opts.overlayOpts?.showLightRadius ?? false,
              enableCutaway:     enableCutawayRef.current,
              cutawayTransition: trans,
              playerScreenY,
              interiorTiles:     interiorTilesRef.current,
              sortedCells:       sortedCellsRef.current,
            },
          );
          const frameTime = performance.now() - drawStart;

          // ── Update perf overlay (direct DOM, no React re-render) ──────────────
          if (perfDebugRef.current && perfOverlayRef.current) {
            const hist   = fpsHistoryRef.current;
            const avgFps = hist.length > 0 ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
            const slow   = frameTime > 16;
            const fpsCol = avgFps < 30 ? '#ff4444' : avgFps < 50 ? '#ffaa00' : '#00ff88';
            perfOverlayRef.current.innerHTML =
              `<div style="color:${fpsCol};font-weight:bold">` +
                `FPS  ${avgFps.toFixed(1)}` +
              `</div>` +
              `<div style="color:${slow ? '#ff6644' : '#888'}">` +
                `DRAW ${frameTime.toFixed(2)} ms${slow ? ' ⚠' : ''}` +
              `</div>` +
              `<div style="color:#666">TILES  ${metrics?.tilesRendered ?? '—'}</div>` +
              `<div style="color:#666">PROPS  ${metrics?.propsRendered ?? '—'}</div>` +
              `<div style="color:#666">LIGHTS ${metrics?.lightsRendered ?? '—'}</div>`;
          }
        }
      }

      animRafRef.current = requestAnimationFrame(tick);
    };
    animRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRafRef.current);
  }, []); // empty — RAF always runs

  // ── Cache hasWater flag (avoid per-frame tile scan) ─────────────────────────
  useEffect(() => {
    hasWaterRef.current = zone?.tiles?.some(row => row.some(t => t === WATER_TYPE)) ?? false;
  }, [zone?.tiles]);

  // ── Cache painter's-order sorted cell list (avoid O(n log n) sort per frame) ─
  useEffect(() => {
    if (!zone?.tiles) { sortedCellsRef.current = []; return; }
    sortedCellsRef.current = computeSortedCells(zone.tiles, zone.heights);
  }, [zone?.tiles, zone?.heights]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cache frameLights (rebuild only when props/lights change, not every RAF tick)
  useEffect(() => {
    frameLightsRef.current = zone ? buildFrameLights(zone) : [];
  }, [zone?.props, zone?.lights]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recompute interior tiles when zone changes ────────────────────────────────
  useEffect(() => {
    if (zone?.tiles) {
      interiorTilesRef.current = computeInteriorTiles(zone.tiles);
    } else {
      interiorTilesRef.current = new Set();
    }
  }, [zone?.tiles]);

  // ── Canvas resize ────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = container.offsetWidth;
      canvas.height = container.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Canvas redraw (reactive — fires on state changes) ────────────────────────
  // The RAF loop handles continuous animation; this ensures immediate response
  // to non-animation state changes (tile paint, entity move, zoom, etc.).
  useEffect(() => {
    const canvas  = canvasRef.current;
    if (!canvas) return;
    const zoneType = zone?.type ?? 'surface';
    const fovSet   = (showFOV && fovOrigin && zone?.tiles)
      ? computeFOV(fovOrigin.x, fovOrigin.y, zone.tiles, fovRadius)
      : null;
    const rotatedPrefab = PREFABS[activePrefab] ? rotatePrefab(PREFABS[activePrefab], prefabRotation) : null;
    const ghostProp  = (editorMode === 'props' && ghostPropTile)
      ? { ...ghostPropTile, type: activePropType }
      : null;
    const ghostPrefab = (editorMode === 'prefabs' && ghostPrefabTile && rotatedPrefab)
      ? { prefab: rotatedPrefab, ...ghostPrefabTile }
      : null;
    const trans  = cutawayTransitionRef.current;
    const bLight = enableLighting ? getBlendedLightingConfig(trans) : null;
    // Compute player screen Y for cutaway from fovOrigin (editor proxy for player pos)
    let playerScreenY = 0;
    if (fovOrigin && zone?.tiles) {
      const { x: wx, y: wy } = gridToScreen(fovOrigin.y, fovOrigin.x, ISO_ORIGIN, TW, TH);
      const hh_ = getH(zone?.heights, fovOrigin.y, fovOrigin.x);
      playerScreenY = (wy - hh_ * HEIGHT_SCALE + TH * 0.5) * camera.zoom + camera.panY;
    }
    drawMapCanvas(
      canvas, zone, hoveredTile, camera, config,
      selectedEntityId, editorMode,
      {
        refImage, refOpacity, refVisible, showGrid, debugMode,
        heights:        zone?.heights   ?? null, showHeightDebug,
        waterFlow:      zone?.waterFlow ?? null,
        animOffset:     animOffsetRef.current,
        waterMod:       ZONE_ENV[zoneType]?.waterMod ?? null,
        zoneType,
        props:          zone?.props  ?? null,
        surface:        zone?.surface ?? null,
        showProps, showSurface, showPropBounds,
        selectedPropId, ghostProp, ghostPrefab,
        fovSet, showFOV,
        // Lighting
        lights:           enableLighting ? frameLightsRef.current : [],
        enableLighting,
        darkAlpha:        bLight?.darkAlpha ?? 0.78,
        showLightRadius,
        // Cutaway
        enableCutaway,
        cutawayTransition: trans,
        playerScreenY,
        showInteriorZones,
        interiorTiles:    interiorTilesRef.current,
        // Lighting authoring
        selectedLightId,
        showLightMarkers: editorMode === 'lighting' || showLightMarkers,
        // Tile variation
        tileVariation,
        // Pre-sorted cells (cached by useEffect)
        sortedCells: sortedCellsRef.current,
      },
    );
  }, [zone, hoveredTile, camera, config, selectedEntityId, editorMode,
      refImage, refOpacity, refVisible, showGrid, debugMode, showHeightDebug,
      showProps, showSurface, showPropBounds, selectedPropId,
      ghostPropTile, ghostPrefabTile, activePropType, activePrefab, prefabRotation,
      showFOV, fovOrigin, fovRadius,
      enableLighting, enableCutaway, showLightRadius, showInteriorZones,
      selectedLightId, showLightMarkers, tileVariation]);

  // ── Center camera on new map ──────────────────────────────────────────────────
  useEffect(() => {
    if (!zone || !canvasRef.current) return;
    const { width, height } = canvasRef.current;
    if (!width || !height) return;
    setCamera(getInitialCamera(zone, width, height));
  }, [currentMapId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zone list fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/zones/index.json')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setZoneList(Array.isArray(data) ? data : FALLBACK_ZONES))
      .catch(() => setZoneList(FALLBACK_ZONES));
  }, []);

  // ── History helpers ───────────────────────────────────────────────────────────

  // Push current zone onto the history stack and clear the future.
  // Call BEFORE applying any destructive edit.
  const commitHistory = useCallback(() => {
    const z = zoneRef.current;
    if (!z) return;
    historyRef.current.push(deepClone(z));
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    setHistoryLen(historyRef.current.length);
    setFutureLen(0);
  }, []);

  // Reset stacks when a new map is opened.
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    futureRef.current  = [];
    setHistoryLen(0);
    setFutureLen(0);
  }, []);

  const undo = useCallback(() => {
    if (!historyRef.current.length) return;
    const prev = historyRef.current.pop();
    futureRef.current.push(deepClone(zoneRef.current));
    setZone(prev);
    setIsDirty(true);
    setHistoryLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
  }, []);

  const redo = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current.pop();
    historyRef.current.push(deepClone(zoneRef.current));
    setZone(next);
    setIsDirty(true);
    setHistoryLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); redo(); return;
      }
      // R — rotate prefab
      if (e.key === 'r' || e.key === 'R') {
        if (editorModeRef.current === 'prefabs') {
          setPrefabRotation(r => (r + 1) % 4);
        }
        return;
      }
      // Delete / Backspace — remove selected prop or light
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey) {
        if (editorModeRef.current === 'props') {
          setSelectedPropId(id => { if (id) deleteProp(id); return null; });
        }
        if (editorModeRef.current === 'lighting') {
          setSelectedLightId(id => { if (id) deleteLight(id); return null; });
        }
        return;
      }
      // E — interact with nearest container entity (uses fovOrigin as player proxy)
      if (e.key === 'e' || e.key === 'E') {
        const z = zoneRef.current;
        if (!z?.entities?.length) return;
        const fovO = drawOptsRef.current?.overlayOpts?.fovOriginForCutaway;
        if (!fovO) return;
        const rows = z.tiles.length, cols = z.tiles[0].length;
        let nearest = null, nearestDist = Infinity;
        for (const entity of z.entities) {
          if (entity.type !== 'container') continue;
          const grid = worldToGrid(entity.position.x, entity.position.y, rows, cols);
          const dist = Math.hypot(grid.col - fovO.x, grid.row - fovO.y);
          if (dist < 2.5 && dist < nearestDist) { nearest = entity; nearestDist = dist; }
        }
        if (!nearest) return;
        const lootTableId = nearest.config?.lootTableId
          ?? CONTAINER_LOOT_TABLES[nearest.subtype] ?? 'basic_chest';
        // Use cached contents if already opened; otherwise generate deterministically
        let contents = nearest.config?.opened && nearest.config?.contents?.length
          ? nearest.config.contents
          : generateLoot(lootTableId,
              nearest.config?.seed
                ?? nearest.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
        // Persist opened state and contents
        setZone(prev => {
          if (!prev) return prev;
          const idx = prev.entities.findIndex(e => e.id === nearest.id);
          if (idx === -1) return prev;
          return {
            ...prev,
            entities: prev.entities.map((e, i) =>
              i === idx ? { ...e, config: { ...e.config, opened: true, contents } } : e
            ),
          };
        });
        setIsDirty(true);
        setLootPopup({
          entityId: nearest.id,
          title:    `${nearest.subtype.charAt(0).toUpperCase() + nearest.subtype.slice(1)} Opened`,
          lines:    contents.map(entry => lootLine(entry)),
        });
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, deleteProp, deleteLight]);

  // ── Zone load ─────────────────────────────────────────────────────────────────
  const loadZoneById = useCallback(async (id) => {
    setLoadError(null);
    try {
      const res = await fetch(`/zones/${id}.json`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setZone(data);
      setCurrentMapId(id);
      setIsDirty(false);
      setSelectedEntityId(null);
      clearHistory();
    } catch (err) {
      setLoadError(`Could not load "${id}": ${err.message}`);
    }
  }, [clearHistory]);

  // ── File upload ───────────────────────────────────────────────────────────────
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setZone(data);
        setCurrentMapId(data.id ?? file.name.replace('.json', ''));
        setIsDirty(false);
        setLoadError(null);
        setSelectedEntityId(null);
        clearHistory();
      } catch {
        setLoadError('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [clearHistory]);

  // ── New map ───────────────────────────────────────────────────────────────────
  const handleNewMap = useCallback(() => {
    const id = `map_${Date.now()}`;
    const w  = 15, h = 15;
    setZone({
      id, name: 'New Map',
      config: { width: w, height: h, seed: Date.now() },
      playerStart: { x: 0, z: 0 },
      tiles: Array.from({ length: h }, () => Array(w).fill(TILE_TYPES.WALL)),
      entities: [],
      systems: { keys: [], doors: [], enemies: [], portals: [], quests: [] },
    });
    setCurrentMapId(id);
    setIsDirty(false);
    setLoadError(null);
    setSelectedEntityId(null);
    clearHistory();
  }, [clearHistory]);

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!zone) return;
    const blob = new Blob([JSON.stringify(zone, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${zone.id}.json`; a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
  }, [zone]);

  // ── Screenshot export ─────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    const z      = zoneRef.current;
    if (!canvas || !z) return;
    const url = canvas.toDataURL('image/png');
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${z.id ?? 'map'}_screenshot.png`;
    a.click();
  }, []);

  // ── Reference image upload ────────────────────────────────────────────────────
  const handleRefImageUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setRefImage(img);
      setRefVisible(true);
      URL.revokeObjectURL(url);
    };
    img.src    = url;
    e.target.value = '';
  }, []);

  // ── Map config edits ──────────────────────────────────────────────────────────
  const setMapField = useCallback((field, value) => {
    setZone(prev => prev ? { ...prev, [field]: value } : prev);
    setIsDirty(true);
  }, []);

  const setConfigField = useCallback((field, value) => {
    setZone(prev => prev ? { ...prev, config: { ...prev.config, [field]: value } } : prev);
    setIsDirty(true);
  }, []);

  // ── Tile tool ─────────────────────────────────────────────────────────────────
  // Handles paint (with brush size), erase (with brush size), and fill.
  // When painting water, also writes flow direction into zone.waterFlow.
  const applyTileTool = useCallback((row, col) => {
    const tool     = brushToolRef.current;
    const size     = brushSizeRef.current;
    const tileType = tool === 'erase' ? 0 : selectedTileTypeRef.current;
    const isWater  = tileType === WATER_TYPE;
    const flowDir  = isWater ? selectedFlowDirRef.current : null;

    setZone(prev => {
      if (!prev) return prev;
      const rows = prev.tiles.length;
      const cols = prev.tiles[0].length;
      let newTiles;

      if (tool === 'fill') {
        newTiles = floodFill(prev.tiles, row, col, tileType);
        if (!newTiles) return prev;
      } else {
        newTiles = applyBrush(prev.tiles, row, col, tileType, size);
        if (!newTiles) return prev;
      }

      // Keep waterFlow in sync when painting/erasing water tiles
      if (isWater || tool === 'erase') {
        const curFlow = ensureWaterFlow(prev, rows, cols);
        const newFlow = curFlow.map(r => [...r]);
        const radius  = Math.floor(size / 2);

        if (tool === 'fill') {
          for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++)
              if (prev.tiles[r][c] !== newTiles[r][c])
                newFlow[r][c] = isWater ? flowDir : null;
        } else {
          for (let dr = -radius; dr <= radius; dr++)
            for (let dc = -radius; dc <= radius; dc++) {
              const r = row + dr, c = col + dc;
              if (r >= 0 && r < rows && c >= 0 && c < cols)
                newFlow[r][c] = tool === 'erase' ? null : flowDir;
            }
        }
        return { ...prev, tiles: newTiles, waterFlow: newFlow };
      }

      return { ...prev, tiles: newTiles };
    });
    setIsDirty(true);
  }, []);

  // ── Height adjustment ─────────────────────────────────────────────────────────
  // Raises or lowers a single tile's elevation by `delta` (+1 or −1), clamped
  // to [MIN_HEIGHT, MAX_HEIGHT].  Stored in zone.heights separate from zone.tiles.
  const adjustHeight = useCallback((row, col, delta) => {
    setZone(prev => {
      if (!prev) return prev;
      const newHeights = ensureHeights(prev).map(r => [...r]);
      const newVal = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeights[row][col] + delta));
      if (newVal === newHeights[row][col]) return prev;
      newHeights[row][col] = newVal;
      return { ...prev, heights: newHeights };
    });
    setIsDirty(true);
  }, []);

  // ── Entity CRUD ───────────────────────────────────────────────────────────────
  const placeEntity = useCallback((row, col) => {
    const z = zoneRef.current;
    if (!z) return;
    const rows = z.tiles.length;
    const cols = z.tiles[0].length;
    const def  = selectedEntityDefRef.current;
    const id   = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newEntity = {
      id,
      type:     def.type,
      subtype:  def.subtype,
      position: gridToWorld(row, col, rows, cols),
      facing:   'south',
      config:   { ...def.defaultConfig },
    };
    setZone(prev => {
      if (!prev) return prev;
      return { ...prev, entities: [...(prev.entities ?? []), newEntity] };
    });
    setSelectedEntityId(id);
    setIsDirty(true);
  }, []);

  const deleteEntity = useCallback((id) => {
    commitHistory();
    setZone(prev => {
      if (!prev) return prev;
      return { ...prev, entities: (prev.entities ?? []).filter(e => e.id !== id) };
    });
    setSelectedEntityId(null);
    setIsDirty(true);
  }, [commitHistory]);

  const updateEntity = useCallback((id, updates) => {
    setZone(prev => {
      if (!prev) return prev;
      const idx = prev.entities.findIndex(e => e.id === id);
      if (idx === -1) return prev;
      return {
        ...prev,
        entities: prev.entities.map((e, i) => i === idx ? { ...e, ...updates } : e),
      };
    });
    setIsDirty(true);
  }, []);

  const updateEntityConfig = useCallback((id, key, value) => {
    setZone(prev => {
      if (!prev) return prev;
      const idx = prev.entities.findIndex(e => e.id === id);
      if (idx === -1) return prev;
      return {
        ...prev,
        entities: prev.entities.map((e, i) =>
          i === idx ? { ...e, config: { ...e.config, [key]: value } } : e
        ),
      };
    });
    setIsDirty(true);
  }, []);

  // ── Prop CRUD ─────────────────────────────────────────────────────────────────
  const placeProp = useCallback((x, y) => {
    const z = zoneRef.current;
    if (!z) return;
    const existingProps = z.props ?? [];
    if (!canPlaceProp(x, y, activePropType, existingProps, z.tiles)) return;
    const def = PROP_DEFS[activePropType];
    const prop = {
      id:      `prop_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      type:    activePropType,
      x, y,
      offsetX: (Math.random() - 0.5) * 0.3,
      offsetY: (Math.random() - 0.5) * 0.2,
      rotation: def?.anchor !== 'wall' ? Math.random() * Math.PI * 2 : 0,
      scale:   0.88 + Math.random() * 0.28,
    };
    setZone(prev => {
      if (!prev) return prev;
      return { ...prev, props: [...(prev.props ?? []), prop] };
    });
    setSelectedPropId(prop.id);
    setIsDirty(true);
  }, [activePropType]);

  const deleteProp = useCallback((id) => {
    commitHistory();
    setZone(prev => {
      if (!prev) return prev;
      return { ...prev, props: (prev.props ?? []).filter(p => p.id !== id) };
    });
    setSelectedPropId(null);
    setIsDirty(true);
  }, [commitHistory]);

  // ── Light CRUD (zone.lights) ──────────────────────────────────────────────────
  const placeLight = useCallback((row, col) => {
    const preset = LIGHT_PRESETS[activeLightTypeRef.current] ?? LIGHT_PRESETS.torch;
    const id = `light_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const light = {
      id,
      type:         activeLightTypeRef.current,
      x:            col,
      y:            row,
      radius:       preset.radius,
      intensity:    preset.intensity,
      color:        { ...preset.color },
      flicker:      preset.flicker,
      flickerSpeed: 1.0,
    };
    commitHistory();
    setZone(prev => {
      if (!prev) return prev;
      return { ...prev, lights: [...(prev.lights ?? []), light] };
    });
    setSelectedLightId(id);
    setIsDirty(true);
  }, [commitHistory]);

  const deleteLight = useCallback((id) => {
    commitHistory();
    setZone(prev => {
      if (!prev) return prev;
      return { ...prev, lights: (prev.lights ?? []).filter(l => l.id !== id) };
    });
    setSelectedLightId(null);
    setIsDirty(true);
  }, [commitHistory]);

  const updateLight = useCallback((id, updates) => {
    setZone(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lights: (prev.lights ?? []).map(l => l.id === id ? { ...l, ...updates } : l),
      };
    });
    setIsDirty(true);
  }, []);

  // ── Prop scatter ───────────────────────────────────────────────────────────────
  const scatterProps = useCallback((row, col) => {
    const z = zoneRef.current;
    if (!z) return;
    const radius  = Math.max(1, Math.floor(scatterRadiusRef.current / 2));
    const density = scatterDensityRef.current;
    const pType   = activePropTypeRef.current;
    const rows_   = z.tiles.length;
    const cols_   = z.tiles[0].length;
    const def     = PROP_DEFS[pType];
    const existingProps = z.props ?? [];
    const newProps = [];

    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.random() > density) continue;
        const r = row + dr, c = col + dc;
        if (r < 0 || r >= rows_ || c < 0 || c >= cols_) continue;
        if (z.tiles[r][c] === 0) continue;
        const combined = [...existingProps, ...newProps];
        if (!canPlaceProp(c, r, pType, combined, z.tiles)) continue;
        newProps.push({
          id:       `prop_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          type:     pType,
          x:        c,
          y:        r,
          offsetX:  (Math.random() - 0.5) * 0.44,
          offsetY:  (Math.random() - 0.5) * 0.32,
          rotation: def?.anchor !== 'wall' ? Math.random() * Math.PI * 2 : 0,
          scale:    0.72 + Math.random() * 0.52,
        });
      }
    }
    if (!newProps.length) return;
    setZone(prev => {
      if (!prev) return prev;
      return { ...prev, props: [...(prev.props ?? []), ...newProps] };
    });
    setIsDirty(true);
  }, []);

  // ── Surface paint ─────────────────────────────────────────────────────────────
  const paintSurface = useCallback((row, col, erase = false) => {
    const z = zoneRef.current;
    if (!z) return;
    const radius = Math.floor(surfaceBrushSizeRef.current / 2);
    setZone(prev => {
      if (!prev) return prev;
      const newSurface = { ...(prev.surface ?? {}) };
      const rows_ = prev.tiles.length, cols_ = prev.tiles[0].length;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const rr = row + dr, cc = col + dc;
          if (rr < 0 || rr >= rows_ || cc < 0 || cc >= cols_) continue;
          if (prev.tiles[rr][cc] === 0) continue;
          const key = `${cc},${rr}`;
          if (erase) {
            delete newSurface[key];
          } else {
            const existing = newSurface[key] ?? [];
            if (!existing.includes(activeSurface))
              newSurface[key] = [...existing, activeSurface];
          }
        }
      }
      return { ...prev, surface: newSurface };
    });
    setIsDirty(true);
  }, [activeSurface]);

  // ── Grid hit-test ─────────────────────────────────────────────────────────────
  const hitTest = useCallback((mouseX, mouseY) => {
    const z = zoneRef.current;
    if (!z) return null;
    const cam    = cameraRef.current;
    const worldX = (mouseX - cam.panX) / cam.zoom;
    const worldY = (mouseY - cam.panY) / cam.zoom;
    return screenToGrid(worldX, worldY, ISO_ORIGIN, TW, TH, z.tiles.length, z.tiles[0].length);
  }, []);

  // ── Mouse events ──────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    // Middle-click always pans
    if (e.button === 1) {
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 0) {
      // Rotation view: editing disabled — only allow panning
      if (rotationAngleRef.current !== 0) {
        isPanningRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (editorModeRef.current === 'entity') {
        // Select existing marker
        const hit = entityHitTest(mx, my, zoneRef.current, cameraRef.current);
        if (hit) { setSelectedEntityId(hit.id); return; }
        // Place on tile
        const tile = hitTest(mx, my);
        if (tile) {
          commitHistory();
          placeEntity(tile.row, tile.col);
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }

      } else if (editorModeRef.current === 'height') {
        const tile = hitTest(mx, my);
        if (tile) {
          const delta = e.shiftKey ? -1 : 1;
          heightDeltaRef.current = delta;
          commitHistory();
          adjustHeight(tile.row, tile.col, delta);
          setIsPainting(true);
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }

      } else if (editorModeRef.current === 'props') {
        const tile = hitTest(mx, my);
        if (tile) {
          const z = zoneRef.current;
          if (propToolRef.current === 'scatter') {
            scatterProps(tile.row, tile.col);
            setIsScattering(true);
          } else {
            // Paint mode: shift+click near prop selects/deletes; otherwise place
            const propsArr = z?.props ?? [];
            const nearby   = propsArr.find(p => Math.abs(p.x - tile.col) < 1.5 && Math.abs(p.y - tile.row) < 1.5);
            if (e.shiftKey && nearby) {
              deleteProp(nearby.id);
            } else if (!e.shiftKey && nearby) {
              setSelectedPropId(nearby.id);
            } else {
              commitHistory();
              placeProp(tile.col, tile.row);
            }
          }
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }

      } else if (editorModeRef.current === 'lighting') {
        const z = zoneRef.current;
        // Hit-test existing lights first
        const hitLight = lightHitTest(mx, my, z, cameraRef.current, z?.heights);
        if (hitLight) {
          setSelectedLightId(hitLight.id);
        } else {
          const tile = hitTest(mx, my);
          if (tile) {
            placeLight(tile.row, tile.col);
          } else {
            isPanningRef.current = true;
            lastMouseRef.current = { x: e.clientX, y: e.clientY };
          }
        }

      } else if (editorModeRef.current === 'surface') {
        const tile = hitTest(mx, my);
        if (tile) {
          commitHistory();
          paintSurface(tile.row, tile.col, e.shiftKey);
          setIsPaintingSurface(true);
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }

      } else if (editorModeRef.current === 'prefabs') {
        const tile = hitTest(mx, my);
        if (tile) {
          const z = zoneRef.current;
          if (!z) return;
          const rot     = prefabRotationRef.current;
          const prefabId = activePrefabRef.current;
          const raw     = PREFABS[prefabId];
          if (!raw) return;
          const prefab  = rotatePrefab(raw, rot);
          const ox      = tile.col - prefab.origin.x;
          const oy      = tile.row - prefab.origin.y;
          if (canPlacePrefab(ox, oy, prefab, z)) {
            commitHistory();
            setZone(prev => prev ? applyPrefab(prev, ox, oy, prefab, prefabStampModeRef.current) : prev);
            setIsDirty(true);
          }
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }

      } else {
        // Tile mode ─ Alt+click picks tile type
        if (e.altKey) {
          const tile = hitTest(mx, my);
          if (tile) {
            const z = zoneRef.current;
            if (z) {
              const picked = z.tiles[tile.row][tile.col];
              if (picked !== 0) setSelectedTileType(picked);
            }
          }
          return;
        }

        // Normal tile tool
        const tile = hitTest(mx, my);
        if (tile) {
          commitHistory();
          applyTileTool(tile.row, tile.col);
          // fill is single-shot — no drag painting
          if (brushToolRef.current !== 'fill') setIsPainting(true);
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }
      }
    }
  }, [hitTest, applyTileTool, placeEntity, commitHistory, adjustHeight,
      placeProp, deleteProp, paintSurface, placeLight, scatterProps]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isPanningRef.current) {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setCamera(prev => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
      return;
    }

    const tile = hitTest(mx, my);
    setHovered(tile);

    // Drag-paint (tile mode only, not fill)
    if (editorModeRef.current === 'tile' && isPaintingRef.current && tile) {
      applyTileTool(tile.row, tile.col);
    }
    // Drag-adjust height
    if (editorModeRef.current === 'height' && isPaintingRef.current && tile) {
      adjustHeight(tile.row, tile.col, heightDeltaRef.current);
    }
    // Drag-paint surface
    if (editorModeRef.current === 'surface' && isPaintingSurface && tile) {
      paintSurface(tile.row, tile.col, false);
    }
    // Ghost prop preview / scatter drag
    if (editorModeRef.current === 'props') {
      if (tile) {
        const z   = zoneRef.current;
        if (isScattering && tile) {
          scatterProps(tile.row, tile.col);
        }
        const valid = z ? canPlaceProp(tile.col, tile.row, activePropTypeRef.current,
                                       z.props ?? [], z.tiles) : false;
        setGhostPropTile({ x: tile.col, y: tile.row, valid });
      } else {
        setGhostPropTile(null);
      }
    }
    // Ghost prefab preview
    if (editorModeRef.current === 'prefabs') {
      if (tile) {
        const z     = zoneRef.current;
        const raw   = PREFABS[activePrefabRef.current];
        const pfb   = raw ? rotatePrefab(raw, prefabRotationRef.current) : null;
        if (pfb && z) {
          const ox = tile.col - pfb.origin.x, oy = tile.row - pfb.origin.y;
          setGhostPrefabTile({ x: ox, y: oy, valid: canPlacePrefab(ox, oy, pfb, z) });
        } else {
          setGhostPrefabTile(null);
        }
      } else {
        setGhostPrefabTile(null);
      }
    }
  }, [hitTest, applyTileTool, adjustHeight, paintSurface, isPaintingSurface, isScattering, scatterProps]);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPainting(false);
    setIsPaintingSurface(false);
    setIsScattering(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    setIsPainting(false);
    setIsPaintingSurface(false);
    setIsScattering(false);
    setHovered(null);
    setGhostPropTile(null);
    setGhostPrefabTile(null);
  }, []);

  // ── Wheel zoom ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect   = canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setCamera(prev => {
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.zoom * factor));
        const worldX  = (mx - prev.panX) / prev.zoom;
        const worldY  = (my - prev.panY) / prev.zoom;
        return { zoom: newZoom, panX: mx - worldX * newZoom, panY: my - worldY * newZoom };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ── Mode switch ───────────────────────────────────────────────────────────────
  const switchMode = useCallback((mode) => {
    setEditorMode(mode);
    setSelectedEntityId(null);
    setSelectedLightId(null);
    setHovered(null);
    setGhostPropTile(null);
    setGhostPrefabTile(null);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────────
  const selectedEntity  = zone?.entities?.find(e => e.id === selectedEntityId) ?? null;
  const tileTypeEntries = Object.entries(TILE_TYPES);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* ── Left panel ───────────────────────────────────────────────────────── */}
      <div style={{
        width: 264, flexShrink: 0, background: P.panel,
        borderRight: `1px solid ${P.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Mode toggle — two rows */}
        <div style={{ display: 'flex', flexDirection: 'column', borderBottom: `1px solid ${P.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex' }}>
            {[['tile', 'TILE'], ['height', 'HT'], ['entity', 'ENT'], ['generate', 'GEN']].map(([mode, label]) => {
              const active = editorMode === mode;
              return (
                <button key={mode} onClick={() => switchMode(mode)} style={{
                  flex: 1, background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                  border: 'none', borderBottom: `2px solid ${active ? P.accent : 'transparent'}`,
                  color: active ? P.accent : P.muted,
                  fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                  padding: '8px 0', cursor: 'pointer',
                }}>
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', borderTop: `1px solid ${P.border}` }}>
            {[['props', 'PROPS'], ['surface', 'SURF'], ['prefabs', 'PFB'], ['lighting', 'LGT']].map(([mode, label]) => {
              const active = editorMode === mode;
              return (
                <button key={mode} onClick={() => switchMode(mode)} style={{
                  flex: 1, background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                  border: 'none', borderBottom: `2px solid ${active ? P.accent : 'transparent'}`,
                  color: active ? P.accent : P.muted,
                  fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                  padding: '7px 0', cursor: 'pointer',
                }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', padding: '14px 14px',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}>

          {/* ── MAPS ─────────────────────────────────────────────────────────── */}
          <Section title="MAPS">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {zoneList.map(id => (
                <button key={id} onClick={() => loadZoneById(id)} style={{
                  ...btnStyle(id === currentMapId ? P.accent : P.muted),
                  textAlign: 'left', fontSize: 10, letterSpacing: 1, padding: '6px 10px',
                  background: id === currentMapId ? 'rgba(0,212,255,0.07)' : 'transparent',
                }}>
                  {id}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleNewMap}
                style={{ ...btnStyle(P.accent), flex: 1, fontSize: 10, padding: '6px 8px' }}>
                + NEW MAP
              </button>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ ...btnStyle(P.muted), fontSize: 10, padding: '6px 8px' }}>
                UPLOAD
              </button>
              <input ref={fileInputRef} type="file" accept=".json"
                style={{ display: 'none' }} onChange={handleFileUpload} />
            </div>
            {loadError && (
              <div style={{ fontSize: 10, color: P.warn, letterSpacing: 1 }}>{loadError}</div>
            )}
          </Section>

          {/* ── MAP CONFIG ───────────────────────────────────────────────────── */}
          {zone && (
            <Section title="MAP CONFIG">
              <FieldRow label="NAME">
                <input style={inputStyle} value={zone.name ?? ''}
                  onChange={e => setMapField('name', e.target.value)} />
              </FieldRow>
              <FieldRow label="ID">
                <input style={{ ...inputStyle, color: P.muted }} value={zone.id ?? ''} readOnly />
              </FieldRow>
              <div style={{ display: 'flex', gap: 6 }}>
                <FieldRow label="W">
                  <input style={{ ...inputStyle, width: 42 }} type="number" min={1} max={64}
                    value={zone.config?.width ?? 15}
                    onChange={e => setConfigField('width', parseInt(e.target.value) || 15)} />
                </FieldRow>
                <FieldRow label="H">
                  <input style={{ ...inputStyle, width: 42 }} type="number" min={1} max={64}
                    value={zone.config?.height ?? 15}
                    onChange={e => setConfigField('height', parseInt(e.target.value) || 15)} />
                </FieldRow>
              </div>
              <FieldRow label="SEED">
                <input style={inputStyle} type="number"
                  value={zone.config?.seed ?? 0}
                  onChange={e => setConfigField('seed', parseInt(e.target.value) || 0)} />
              </FieldRow>
              <FieldRow label="ZONE TYPE">
                <select
                  style={selectStyle}
                  value={zone.type ?? 'surface'}
                  onChange={e => setMapField('type', e.target.value)}
                >
                  {Object.entries(ZONE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </FieldRow>
            </Section>
          )}

          {/* ── TILE MODE ────────────────────────────────────────────────────── */}
          {editorMode === 'tile' && (
            <>
              {/* Brush tools */}
              <Section title="BRUSH">
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['paint', 'PAINT'], ['erase', 'ERASE'], ['fill', 'FILL']].map(([id, label]) => {
                    const active = brushTool === id;
                    return (
                      <button key={id} onClick={() => setBrushTool(id)} style={{
                        flex: 1,
                        background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        color: active ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                        padding: '6px 4px', cursor: 'pointer',
                      }}>
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Brush size — hidden for fill (it's always the full region) */}
                {brushTool !== 'fill' && (
                  <FieldRow label="SIZE">
                    <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                      {[1, 3, 5].map(s => {
                        const active = brushSize === s;
                        return (
                          <button key={s} onClick={() => setBrushSize(s)} style={{
                            flex: 1,
                            background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
                            border: `1px solid ${active ? P.accent : P.border}`,
                            color: active ? P.accent : P.muted,
                            fontFamily: 'monospace', fontSize: 9,
                            padding: '5px 0', cursor: 'pointer',
                          }}>
                            {s}×{s}
                          </button>
                        );
                      })}
                    </div>
                  </FieldRow>
                )}

                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                  ALT+CLICK to pick tile type<br />
                  CTRL+Z undo · CTRL+Y redo
                </div>
              </Section>

              {/* Terrain palette (primary) */}
              <Section title="TERRAIN">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(TERRAIN_TYPES).map(([key, typeId]) => {
                    const active  = selectedTileType === typeId;
                    const preview = TERRAIN_PREVIEW[typeId];
                    return (
                      <button key={key} onClick={() => setSelectedTileType(typeId)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        padding: '7px 10px', cursor: 'pointer', width: '100%',
                      }}>
                        <span style={{
                          width: 20, height: 14, flexShrink: 0, borderRadius: 2,
                          border: `1px solid ${P.border}`,
                          background: `linear-gradient(135deg, ${preview} 50%, ${preview}cc 50%)`,
                        }} />
                        <span style={{
                          fontFamily: 'monospace', fontSize: 10,
                          color: active ? P.accent : P.text, letterSpacing: 2,
                        }}>
                          {TERRAIN_LABELS[typeId].toUpperCase()}
                        </span>
                        {active && (
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent }}>
                            ACTIVE
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Water tile */}
                  {(() => {
                    const active = selectedTileType === WATER_TYPE;
                    return (
                      <button onClick={() => setSelectedTileType(WATER_TYPE)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        padding: '7px 10px', cursor: 'pointer', width: '100%',
                      }}>
                        <span style={{
                          width: 20, height: 14, flexShrink: 0, borderRadius: 2,
                          border: `1px solid ${P.border}`,
                          background: 'linear-gradient(135deg, #3078af 50%, #2060a0 50%)',
                        }} />
                        <span style={{
                          fontFamily: 'monospace', fontSize: 10,
                          color: active ? P.accent : P.text, letterSpacing: 2,
                        }}>
                          WATER
                        </span>
                        {active && (
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent }}>
                            ACTIVE
                          </span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </Section>

              {/* Flow direction — shown when Water is selected */}
              {selectedTileType === WATER_TYPE && (
                <Section title="WATER FLOW">
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[null, 'north', 'east', 'south', 'west'].map(dir => {
                      const active = selectedFlowDir === dir;
                      const label  = dir ? dir.slice(0, 1).toUpperCase() : '—';
                      return (
                        <button key={dir ?? 'none'} onClick={() => setSelectedFlowDir(dir)} style={{
                          flex: 1,
                          background: active ? 'rgba(0,212,255,0.14)' : 'transparent',
                          border: `1px solid ${active ? P.accent : P.border}`,
                          color: active ? P.accent : P.muted,
                          fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                          padding: '5px 2px', cursor: 'pointer',
                        }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1 }}>
                    — = still water · N/E/S/W = river flow
                  </div>
                </Section>
              )}

              {/* Zone-specific tile palette */}
              {zone && ZONE_ENV[zone.type ?? 'surface']?.tilesetIds && (
                <Section title={`${(zone.type ?? 'surface').toUpperCase()} TILES`}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(ZONE_ENV[zone.type].tilesetIds ?? []).map(typeId => {
                      const active  = selectedTileType === typeId;
                      const preview = ZONE_TILE_PREVIEW[typeId] ?? '#808080';
                      return (
                        <button key={typeId} onClick={() => setSelectedTileType(typeId)} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                          border: `1px solid ${active ? P.accent : P.border}`,
                          padding: '7px 10px', cursor: 'pointer', width: '100%',
                        }}>
                          <span style={{
                            width: 20, height: 14, flexShrink: 0, borderRadius: 2,
                            border: `1px solid ${P.border}`,
                            background: `linear-gradient(135deg, ${preview} 50%, ${preview}cc 50%)`,
                          }} />
                          <span style={{
                            fontFamily: 'monospace', fontSize: 10,
                            color: active ? P.accent : P.text, letterSpacing: 2,
                          }}>
                            {ZONE_TILE_LABELS[typeId]?.toUpperCase() ?? typeId}
                          </span>
                          {active && (
                            <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent }}>
                              ACTIVE
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Legacy game tile palette (secondary) */}
              <Section title="LEGACY TILES">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[TILE_TYPES.FLOOR, TILE_TYPES.WALL, TILE_TYPES.ROAD].map(typeId => {
                    const active = selectedTileType === typeId;
                    const swatch = config.pal[typeId]?.[0] ?? '#808080';
                    return (
                      <button key={typeId} onClick={() => setSelectedTileType(typeId)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        padding: '6px 10px', cursor: 'pointer', width: '100%',
                      }}>
                        <span style={{
                          width: 20, height: 14, flexShrink: 0, borderRadius: 2,
                          background: swatch, border: `1px solid ${P.border}`,
                        }} />
                        <span style={{
                          fontFamily: 'monospace', fontSize: 10,
                          color: active ? P.accent : P.muted, letterSpacing: 2,
                        }}>
                          {TILE_LABELS[typeId].toUpperCase()}
                        </span>
                        {active && (
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent }}>
                            ACTIVE
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.6 }}>
                  CLICK or DRAG to paint<br />SCROLL to zoom · MIDDLE-DRAG to pan
                </div>
              </Section>
            </>
          )}

          {/* ── HEIGHT MODE ──────────────────────────────────────────────────── */}
          {editorMode === 'height' && (
            <>
              <Section title="HEIGHT PAINT">
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.85 }}>
                  CLICK to raise tile (+1)<br />
                  SHIFT+CLICK to lower (−1)<br />
                  DRAG to paint elevation<br />
                  CTRL+Z undo · CTRL+Y redo
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px',
                  background: 'rgba(0,212,255,0.05)',
                  border: `1px solid ${P.border}`,
                }}>
                  <span style={{ fontSize: 9, color: P.muted, letterSpacing: 1 }}>RANGE</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: P.text }}>
                    {MIN_HEIGHT} – {MAX_HEIGHT}
                  </span>
                </div>
                <div style={{
                  display: 'flex', gap: 3, alignItems: 'stretch', height: 28,
                }}>
                  {Array.from({ length: MAX_HEIGHT + 1 }, (_, i) => (
                    <div key={i} style={{
                      flex: 1,
                      background: `rgba(0,212,255,${0.06 + i * 0.12})`,
                      border: `1px solid ${P.border}`,
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                      paddingBottom: 2,
                    }}>
                      <span style={{ fontSize: 7, color: P.muted, fontFamily: 'monospace' }}>{i}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* ── ENTITY MODE ──────────────────────────────────────────────────── */}
          {editorMode === 'entity' && (
            <>
              <Section title="ENTITIES">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {ENTITY_PALETTE.map(def => {
                    const active = selectedEntityDef.type === def.type && selectedEntityDef.subtype === def.subtype;
                    return (
                      <button
                        key={`${def.type}_${def.subtype}`}
                        onClick={() => setSelectedEntityDef(def)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                          border: `1px solid ${active ? P.accent : P.border}`,
                          padding: '7px 10px', cursor: 'pointer', width: '100%',
                        }}
                      >
                        <span style={{
                          width: 14, height: 14, borderRadius: '50%',
                          background: def.color, flexShrink: 0,
                          boxShadow: '0 0 0 1.5px rgba(255,255,255,0.2)',
                        }} />
                        <span style={{
                          fontFamily: 'monospace', fontSize: 10,
                          color: active ? P.accent : P.muted, letterSpacing: 1,
                        }}>
                          {def.label.toUpperCase()}
                        </span>
                        {active && (
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent }}>
                            ACTIVE
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                  CLICK tile to place · CLICK marker to select<br />
                  SCROLL to zoom · MIDDLE-DRAG to pan<br />
                  CTRL+Z undo · CTRL+Y redo
                </div>
              </Section>

              {/* Entity editor panel */}
              {/* Populate dungeon — only shown when zone has _rooms from dungeonGen */}
              {zone?._rooms?.length > 0 && (
                <Section title="DUNGEON POPULATE">
                  <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                    {zone._rooms.length} typed rooms detected.<br />
                    Places enemies, bosses, and quest objectives.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {zone._rooms.map(r => (
                      <span key={r.id} style={{
                        fontSize: 8, padding: '2px 6px', borderRadius: 3,
                        background: ROOM_TYPE_COLORS[r.roomType] ?? '#555',
                        color: '#fff', fontFamily: 'monospace', letterSpacing: 1,
                      }}>
                        {ROOM_TYPE_LABELS[r.roomType] ?? r.roomType}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      commitHistory();
                      setZone(prev => prev ? populateDungeon(prev) : prev);
                      setIsDirty(true);
                    }}
                    style={{ ...btnStyle(P.accent), width: '100%' }}
                  >
                    POPULATE DUNGEON
                  </button>
                </Section>
              )}

              {selectedEntity && (
                <Section title="ENTITY EDITOR">
                  <FieldRow label="TYPE">
                    <span style={{ fontSize: 11, color: P.text, letterSpacing: 1 }}>
                      {selectedEntity.type}
                    </span>
                  </FieldRow>
                  <FieldRow label="SUBTYPE">
                    <span style={{ fontSize: 11, color: P.text, letterSpacing: 1 }}>
                      {selectedEntity.subtype ?? '—'}
                    </span>
                  </FieldRow>
                  <FieldRow label="FACING">
                    <select
                      style={selectStyle}
                      value={selectedEntity.facing ?? 'south'}
                      onChange={e => updateEntity(selectedEntity.id, { facing: e.target.value })}
                    >
                      {FACING_OPTIONS.map(f => (
                        <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                      ))}
                    </select>
                  </FieldRow>
                  {selectedEntity.type === 'structure' && (
                    <>
                      <FieldRow label="ORIENT">
                        <select
                          style={selectStyle}
                          value={selectedEntity.config?.orientation ?? (selectedEntity.subtype === 'bridge' ? 'ew' : 'south')}
                          onChange={e => updateEntityConfig(selectedEntity.id, 'orientation', e.target.value)}
                        >
                          {selectedEntity.subtype === 'bridge'
                            ? [['ew', 'East ↔ West'], ['ns', 'North ↕ South']].map(([v, l]) => (
                                <option key={v} value={v}>{l}</option>
                              ))
                            : ['north', 'south', 'east', 'west'].map(d => (
                                <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                              ))
                          }
                        </select>
                      </FieldRow>
                      <FieldRow label="LENGTH">
                        <input
                          style={{ ...inputStyle, width: 48 }}
                          type="number" min={1} max={12}
                          value={selectedEntity.config?.length ?? 3}
                          onChange={e => updateEntityConfig(selectedEntity.id, 'length', e.target.value)}
                        />
                        <span style={{ fontSize: 9, color: P.muted, letterSpacing: 1, marginLeft: 6 }}>
                          tiles
                        </span>
                      </FieldRow>
                    </>
                  )}
                  {Object.entries(selectedEntity.config ?? {})
                    .filter(([key]) => selectedEntity.type !== 'structure' || !['orientation','length'].includes(key))
                    .map(([key, val]) => (
                      <FieldRow key={key} label={key.toUpperCase()}>
                        <input
                          style={inputStyle}
                          value={val ?? ''}
                          onChange={e => updateEntityConfig(selectedEntity.id, key, e.target.value)}
                        />
                      </FieldRow>
                    ))}
                  <button
                    onClick={() => deleteEntity(selectedEntity.id)}
                    style={{ ...btnStyle(P.warn), width: '100%', marginTop: 2 }}
                  >
                    DELETE ENTITY
                  </button>
                </Section>
              )}
            </>
          )}

          {/* ── GENERATE MODE ────────────────────────────────────────────────── */}
          {editorMode === 'generate' && (
            <>
              <Section title="GENERATOR">
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['cave', 'CAVE'], ['dungeon', 'DUNGEON']].map(([id, label]) => {
                    const active = genMode === id;
                    return (
                      <button key={id} onClick={() => setGenMode(id)} style={{
                        flex: 1,
                        background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        color: active ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                        padding: '6px 4px', cursor: 'pointer',
                      }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Section>

              {genMode === 'cave' && (
                <Section title="CAVE PARAMS">
                  {[
                    ['width',         'W',       'number', 20, 200],
                    ['height',        'H',       'number', 20, 200],
                    ['fillPercent',   'FILL %',  'number',  0, 100],
                    ['smoothSteps',   'SMOOTH',  'number',  1,  12],
                    ['seed',          'SEED',    'number',  0, 999999],
                    ['waterFraction', 'WATER %', 'number',  0, 100],
                  ].map(([field, label]) => (
                    <FieldRow key={field} label={label} labelWidth={60}>
                      <input
                        style={{ ...inputStyle, width: '100%' }}
                        type="number"
                        value={caveParams[field]}
                        onChange={e => setCaveParams(p => ({ ...p, [field]: parseInt(e.target.value) || 0 }))}
                      />
                    </FieldRow>
                  ))}
                  <button
                    onClick={() => {
                      const generated = generateCave({
                        ...caveParams,
                        waterFraction: caveParams.waterFraction / 100,
                      });
                      setZone(generated);
                      setCurrentMapId(generated.id);
                      setIsDirty(true);
                      clearHistory();
                    }}
                    style={{ ...btnStyle(P.accent), width: '100%' }}
                  >
                    GENERATE CAVE
                  </button>
                  <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                    Cellular automata · Rock autotile<br />
                    Largest connected region kept
                  </div>
                </Section>
              )}

              {genMode === 'dungeon' && (
                <Section title="DUNGEON PARAMS">
                  {[
                    ['width',       'W',      'number', 20, 200],
                    ['height',      'H',      'number', 20, 200],
                    ['roomCount',   'ROOMS',  'number',  3,  40],
                    ['minRoomSize', 'MIN SZ', 'number',  2,  12],
                    ['maxRoomSize', 'MAX SZ', 'number',  4,  20],
                    ['seed',        'SEED',   'number',  0, 999999],
                  ].map(([field, label]) => (
                    <FieldRow key={field} label={label} labelWidth={60}>
                      <input
                        style={{ ...inputStyle, width: '100%' }}
                        type="number"
                        value={dungeonParams[field]}
                        onChange={e => setDungeonParams(p => ({ ...p, [field]: parseInt(e.target.value) || 0 }))}
                      />
                    </FieldRow>
                  ))}
                  <button
                    onClick={() => {
                      const generated = generateDungeon(dungeonParams);
                      setZone(generated);
                      setCurrentMapId(generated.id);
                      setIsDirty(true);
                      clearHistory();
                    }}
                    style={{ ...btnStyle(P.accent), width: '100%' }}
                  >
                    GENERATE DUNGEON
                  </button>
                  <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                    Room-and-corridor · MST connected<br />
                    Switch to ENTITY tab to populate
                  </div>
                </Section>
              )}
            </>
          )}

          {/* ── PROPS MODE ──────────────────────────────────────────────────── */}
          {editorMode === 'props' && (
            <>
              <Section title="PROP CATEGORY">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {Object.entries(PROP_CATEGORIES).map(([id, label]) => {
                    const active = propCategory === id;
                    return (
                      <button key={id} onClick={() => setPropCategory(id)} style={{
                        background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        color: active ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                        padding: '5px 10px', cursor: 'pointer',
                      }}>
                        {label.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section title="PROPS">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(PROP_DEFS)
                    .filter(([, def]) => def.category === propCategory)
                    .map(([id, def]) => {
                      const active = activePropType === id;
                      return (
                        <button key={id} onClick={() => setActivePropType(id)} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                          border: `1px solid ${active ? P.accent : P.border}`,
                          padding: '6px 10px', cursor: 'pointer', width: '100%',
                        }}>
                          <span style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: def.color, flexShrink: 0,
                          }} />
                          <span style={{
                            fontFamily: 'monospace', fontSize: 10,
                            color: active ? P.accent : P.muted, letterSpacing: 1,
                          }}>
                            {def.label.toUpperCase()}
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: 8, color: P.muted }}>
                            {def.anchor}
                          </span>
                        </button>
                      );
                    })}
                </div>
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                  CLICK to place · SHIFT+CLICK to delete<br />
                  CLICK marker to select · DEL to remove
                </div>
              </Section>

              {/* Prop tool selector: paint vs scatter */}
              <Section title="TOOL">
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['paint', 'PAINT'], ['scatter', 'SCATTER']].map(([id, label]) => {
                    const active = propTool === id;
                    return (
                      <button key={id} onClick={() => setPropTool(id)} style={{
                        flex: 1,
                        background: active ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        color: active ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                        padding: '6px 4px', cursor: 'pointer',
                      }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {propTool === 'scatter' && (
                  <>
                    <FieldRow label="DENSITY">
                      <input
                        type="range" min={0.05} max={1} step={0.05}
                        value={scatterDensity}
                        onChange={e => setScatterDensity(parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: P.accent }}
                      />
                      <span style={{ fontSize: 9, color: P.muted, width: 30, textAlign: 'right', flexShrink: 0 }}>
                        {Math.round(scatterDensity * 100)}%
                      </span>
                    </FieldRow>
                    <FieldRow label="RADIUS">
                      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                        {[3, 5, 9, 15].map(s => (
                          <button key={s} onClick={() => setScatterRadius(s)} style={{
                            flex: 1,
                            background: scatterRadius === s ? 'rgba(0,212,255,0.12)' : 'transparent',
                            border: `1px solid ${scatterRadius === s ? P.accent : P.border}`,
                            color: scatterRadius === s ? P.accent : P.muted,
                            fontFamily: 'monospace', fontSize: 9,
                            padding: '5px 0', cursor: 'pointer',
                          }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </FieldRow>
                    <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                      CLICK+DRAG to scatter selected<br />
                      prop type randomly in area
                    </div>
                  </>
                )}
              </Section>

              <Section title="VIEW">
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setShowProps(v => !v)} style={{
                    flex: 1,
                    background: showProps ? 'rgba(0,212,255,0.12)' : 'transparent',
                    border: `1px solid ${showProps ? P.accent : P.border}`,
                    color: showProps ? P.accent : P.muted,
                    fontFamily: 'monospace', fontSize: 9, padding: '5px 0', cursor: 'pointer',
                  }}>
                    {showProps ? 'HIDE PROPS' : 'SHOW PROPS'}
                  </button>
                  <button onClick={() => setShowPropBounds(v => !v)} style={{
                    flex: 1,
                    background: showPropBounds ? 'rgba(0,212,255,0.12)' : 'transparent',
                    border: `1px solid ${showPropBounds ? P.accent : P.border}`,
                    color: showPropBounds ? P.accent : P.muted,
                    fontFamily: 'monospace', fontSize: 9, padding: '5px 0', cursor: 'pointer',
                  }}>
                    BOUNDS
                  </button>
                </div>
              </Section>

              {selectedPropId && zone?.props && (
                <Section title="SELECTED PROP">
                  {(() => {
                    const prop = zone.props.find(p => p.id === selectedPropId);
                    if (!prop) return null;
                    const def = PROP_DEFS[prop.type];
                    return (
                      <>
                        <FieldRow label="TYPE">
                          <span style={{ fontSize: 11, color: P.text }}>{def?.label ?? prop.type}</span>
                        </FieldRow>
                        <FieldRow label="POS">
                          <span style={{ fontSize: 11, color: P.text }}>{prop.x},{prop.y}</span>
                        </FieldRow>
                        <FieldRow label="ROT">
                          <input style={{ ...inputStyle, width: 60 }} type="number" step="0.1"
                            value={(prop.rotation ?? 0).toFixed(2)}
                            onChange={e => {
                              const v = parseFloat(e.target.value);
                              setZone(prev => {
                                if (!prev) return prev;
                                return { ...prev, props: prev.props.map(p => p.id === selectedPropId ? { ...p, rotation: v } : p) };
                              });
                              setIsDirty(true);
                            }} />
                        </FieldRow>
                        <FieldRow label="SCALE">
                          <input style={{ ...inputStyle, width: 60 }} type="number" step="0.05" min="0.1" max="3"
                            value={(prop.scale ?? 1).toFixed(2)}
                            onChange={e => {
                              const v = parseFloat(e.target.value);
                              setZone(prev => {
                                if (!prev) return prev;
                                return { ...prev, props: prev.props.map(p => p.id === selectedPropId ? { ...p, scale: v } : p) };
                              });
                              setIsDirty(true);
                            }} />
                        </FieldRow>
                        <button onClick={() => deleteProp(selectedPropId)}
                          style={{ ...btnStyle(P.warn), width: '100%', marginTop: 2 }}>
                          DELETE PROP
                        </button>
                      </>
                    );
                  })()}
                </Section>
              )}
            </>
          )}

          {/* ── SURFACE MODE ─────────────────────────────────────────────────── */}
          {editorMode === 'surface' && (
            <>
              <Section title="SURFACE OVERLAY">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(SURFACE_TYPES).map(([id, def]) => {
                    const active = activeSurface === id;
                    return (
                      <button key={id} onClick={() => setActiveSurface(id)} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        padding: '6px 10px', cursor: 'pointer', width: '100%',
                      }}>
                        <span style={{
                          width: 18, height: 12, flexShrink: 0, borderRadius: 2,
                          background: def.color, border: `1px solid ${P.border}`,
                        }} />
                        <span style={{
                          fontFamily: 'monospace', fontSize: 10,
                          color: active ? P.accent : P.muted, letterSpacing: 1,
                        }}>
                          {def.label.toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <FieldRow label="SIZE">
                  <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                    {[1, 3, 5].map(s => (
                      <button key={s} onClick={() => setSurfaceBrushSize(s)} style={{
                        flex: 1,
                        background: surfaceBrushSize === s ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${surfaceBrushSize === s ? P.accent : P.border}`,
                        color: surfaceBrushSize === s ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9,
                        padding: '5px 0', cursor: 'pointer',
                      }}>
                        {s}×{s}
                      </button>
                    ))}
                  </div>
                </FieldRow>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setShowSurface(v => !v)} style={{
                    flex: 1,
                    background: showSurface ? 'rgba(0,212,255,0.12)' : 'transparent',
                    border: `1px solid ${showSurface ? P.accent : P.border}`,
                    color: showSurface ? P.accent : P.muted,
                    fontFamily: 'monospace', fontSize: 9, padding: '5px 0', cursor: 'pointer',
                  }}>
                    {showSurface ? 'VISIBLE' : 'HIDDEN'}
                  </button>
                  <button
                    onClick={() => {
                      commitHistory();
                      setZone(prev => prev ? { ...prev, surface: {} } : prev);
                      setIsDirty(true);
                    }}
                    style={{ ...btnStyle(P.warn), fontSize: 9, padding: '5px 10px' }}
                  >
                    CLEAR ALL
                  </button>
                </div>
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                  CLICK/DRAG to paint<br />
                  SHIFT+CLICK to erase tile<br />
                  Multiple overlays per tile supported
                </div>
              </Section>
            </>
          )}

          {/* ── PREFABS MODE ─────────────────────────────────────────────────── */}
          {editorMode === 'prefabs' && (
            <>
              <Section title="PREFABS">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(PREFABS).map(([id, pfb]) => {
                    const active = activePrefab === id;
                    return (
                      <button key={id} onClick={() => setActivePrefab(id)} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        padding: '7px 10px', cursor: 'pointer', width: '100%',
                      }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 10,
                          color: active ? P.accent : P.muted, letterSpacing: 1 }}>
                          {pfb.label?.toUpperCase() ?? id}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 8, color: P.muted }}>
                          {pfb.width}×{pfb.height}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <FieldRow label="ROTATE">
                  <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                    {[0, 1, 2, 3].map(r => (
                      <button key={r} onClick={() => setPrefabRotation(r)} style={{
                        flex: 1,
                        background: prefabRotation === r ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${prefabRotation === r ? P.accent : P.border}`,
                        color: prefabRotation === r ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9,
                        padding: '5px 0', cursor: 'pointer',
                      }}>
                        {r * 90}°
                      </button>
                    ))}
                  </div>
                </FieldRow>

                <FieldRow label="MODE">
                  <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                    {[['stamp', 'STAMP'], ['merge', 'MERGE']].map(([id, label]) => (
                      <button key={id} onClick={() => setPrefabStampMode(id)} style={{
                        flex: 1,
                        background: prefabStampMode === id ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${prefabStampMode === id ? P.accent : P.border}`,
                        color: prefabStampMode === id ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9,
                        padding: '5px 0', cursor: 'pointer',
                      }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </FieldRow>

                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                  CLICK tile to stamp · R to rotate<br />
                  MERGE = only fill empty tiles<br />
                  Preview shown on hover
                </div>
              </Section>
            </>
          )}

          {/* ── LIGHTING MODE ────────────────────────────────────────────────── */}
          {editorMode === 'lighting' && (
            <>
              {/* Light type selector */}
              <Section title="LIGHT TYPE">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(LIGHT_PRESETS).map(([id, preset]) => {
                    const active = activeLightType === id;
                    const { r, g, b } = preset.color;
                    return (
                      <button key={id} onClick={() => setActiveLightType(id)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                        border: `1px solid ${active ? P.accent : P.border}`,
                        padding: '7px 10px', cursor: 'pointer', width: '100%',
                      }}>
                        <span style={{
                          width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                          background: `rgb(${r},${g},${b})`,
                          boxShadow: `0 0 6px rgb(${r},${g},${b})`,
                        }} />
                        <span style={{
                          fontFamily: 'monospace', fontSize: 10,
                          color: active ? P.accent : P.muted, letterSpacing: 1,
                        }}>
                          {id.toUpperCase()}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 8, color: P.muted }}>
                          r{preset.radius}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.7 }}>
                  CLICK tile to place light<br />
                  CLICK light to select · DEL removes<br />
                  Enable LIGHTS in toolbar to preview
                </div>
              </Section>

              {/* Atmosphere presets */}
              <Section title="PRESETS">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.values(LIGHTING_PRESETS).map(preset => (
                    <button key={preset.id} onClick={() => {
                      setActiveLightPreset(preset.id);
                      // Optionally wire preset darkAlpha into the lighting system
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: activeLightPreset === preset.id ? 'rgba(0,212,255,0.1)' : 'transparent',
                      border: `1px solid ${activeLightPreset === preset.id ? P.accent : P.border}`,
                      padding: '6px 10px', cursor: 'pointer', width: '100%',
                    }}>
                      <span style={{ fontSize: 14 }}>{preset.emoji}</span>
                      <span style={{
                        fontFamily: 'monospace', fontSize: 10,
                        color: activeLightPreset === preset.id ? P.accent : P.muted, letterSpacing: 1,
                      }}>
                        {preset.label.toUpperCase()}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (!zone) return;
                    const preset = LIGHTING_PRESETS[activeLightPreset];
                    if (!preset) return;
                    // Apply preset dark alpha + store on zone
                    setZone(prev => prev ? { ...prev, lightingPreset: activeLightPreset } : prev);
                    setIsDirty(true);
                  }}
                  style={{ ...btnStyle(P.accent), width: '100%', fontSize: 9 }}
                >
                  APPLY PRESET TO MAP
                </button>
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1 }}>
                  Saves preset ID into map JSON.<br />
                  Game runtime reads it for ambience.
                </div>
              </Section>

              {/* Show markers toggle */}
              <Section title="VIEW">
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setShowLightMarkers(v => !v)} style={{
                    flex: 1,
                    background: showLightMarkers ? 'rgba(0,212,255,0.12)' : 'transparent',
                    border: `1px solid ${showLightMarkers ? P.accent : P.border}`,
                    color: showLightMarkers ? P.accent : P.muted,
                    fontFamily: 'monospace', fontSize: 9, padding: '5px 0', cursor: 'pointer',
                  }}>
                    {showLightMarkers ? 'MARKERS ON' : 'MARKERS OFF'}
                  </button>
                  <button onClick={() => setTileVariation(v => !v)} style={{
                    flex: 1,
                    background: tileVariation ? 'rgba(0,212,255,0.12)' : 'transparent',
                    border: `1px solid ${tileVariation ? P.accent : P.border}`,
                    color: tileVariation ? P.accent : P.muted,
                    fontFamily: 'monospace', fontSize: 9, padding: '5px 0', cursor: 'pointer',
                  }}>
                    VARIATION
                  </button>
                </div>
              </Section>

              {/* Zone light count */}
              <Section title="LIGHTS">
                <div style={{ fontSize: 10, color: P.muted, letterSpacing: 1 }}>
                  {zone?.lights?.length ?? 0} lights in this map
                </div>
                {zone?.lights?.length > 0 && (
                  <button
                    onClick={() => {
                      commitHistory();
                      setZone(prev => prev ? { ...prev, lights: [] } : prev);
                      setSelectedLightId(null);
                      setIsDirty(true);
                    }}
                    style={{ ...btnStyle(P.warn), width: '100%', fontSize: 9 }}
                  >
                    CLEAR ALL LIGHTS
                  </button>
                )}
              </Section>

              {/* Selected light editor */}
              {selectedLightId && (() => {
                const light = zone?.lights?.find(l => l.id === selectedLightId);
                if (!light) return null;
                const hexColor = rgbToHex(typeof light.color === 'object'
                  ? light.color : { r: 255, g: 178, b: 75 });
                return (
                  <Section title="SELECTED LIGHT">
                    <FieldRow label="TYPE">
                      <span style={{ fontSize: 11, color: P.text }}>{light.type}</span>
                    </FieldRow>
                    <FieldRow label="POS">
                      <span style={{ fontSize: 11, color: P.muted }}>col {light.x}, row {light.y}</span>
                    </FieldRow>
                    <FieldRow label="RADIUS">
                      <input
                        type="range" min={40} max={500} step={10}
                        value={light.radius ?? 150}
                        onChange={e => updateLight(light.id, { radius: parseInt(e.target.value) })}
                        style={{ flex: 1, accentColor: P.accent }}
                      />
                      <span style={{ fontSize: 9, color: P.muted, width: 34, textAlign: 'right', flexShrink: 0 }}>
                        {light.radius ?? 150}
                      </span>
                    </FieldRow>
                    <FieldRow label="INTENS">
                      <input
                        type="range" min={0.1} max={1} step={0.05}
                        value={light.intensity ?? 0.9}
                        onChange={e => updateLight(light.id, { intensity: parseFloat(e.target.value) })}
                        style={{ flex: 1, accentColor: P.accent }}
                      />
                      <span style={{ fontSize: 9, color: P.muted, width: 34, textAlign: 'right', flexShrink: 0 }}>
                        {((light.intensity ?? 0.9) * 100).toFixed(0)}%
                      </span>
                    </FieldRow>
                    <FieldRow label="COLOR">
                      <input
                        type="color"
                        value={hexColor}
                        onChange={e => updateLight(light.id, { color: hexToRgb(e.target.value) })}
                        style={{ width: 36, height: 24, border: 'none', background: 'none', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 9, color: P.muted, letterSpacing: 1 }}>{hexColor}</span>
                    </FieldRow>
                    <FieldRow label="FLICKER">
                      <button
                        onClick={() => updateLight(light.id, { flicker: !light.flicker })}
                        style={{
                          background: light.flicker ? 'rgba(255,184,64,0.15)' : 'transparent',
                          border: `1px solid ${light.flicker ? '#ffb840' : P.border}`,
                          color: light.flicker ? '#ffb840' : P.muted,
                          fontFamily: 'monospace', fontSize: 9, letterSpacing: 2,
                          padding: '4px 14px', cursor: 'pointer',
                        }}
                      >
                        {light.flicker ? 'ON' : 'OFF'}
                      </button>
                    </FieldRow>
                    <button
                      onClick={() => deleteLight(light.id)}
                      style={{ ...btnStyle(P.warn), width: '100%', marginTop: 2 }}
                    >
                      DELETE LIGHT
                    </button>
                  </Section>
                );
              })()}
            </>
          )}

          {/* ── REFERENCE IMAGE ──────────────────────────────────────────────── */}
          {zone && (
            <Section title="REFERENCE IMAGE">
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => refImageInputRef.current?.click()}
                  style={{ ...btnStyle(P.muted), flex: 1, fontSize: 9, padding: '6px 8px' }}
                >
                  {refImage ? 'REPLACE' : 'UPLOAD IMAGE'}
                </button>
                {refImage && (
                  <button
                    onClick={() => { setRefImage(null); setRefVisible(false); }}
                    style={{ ...btnStyle(P.warn), fontSize: 9, padding: '6px 8px' }}
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <input
                ref={refImageInputRef}
                type="file" accept="image/*"
                style={{ display: 'none' }}
                onChange={handleRefImageUpload}
              />
              {refImage && (
                <>
                  <FieldRow label="VISIBLE">
                    <button
                      onClick={() => setRefVisible(v => !v)}
                      style={{
                        background: refVisible ? 'rgba(0,212,255,0.12)' : 'transparent',
                        border: `1px solid ${refVisible ? P.accent : P.border}`,
                        color: refVisible ? P.accent : P.muted,
                        fontFamily: 'monospace', fontSize: 9, letterSpacing: 2,
                        padding: '4px 14px', cursor: 'pointer',
                      }}
                    >
                      {refVisible ? 'ON' : 'OFF'}
                    </button>
                  </FieldRow>
                  <FieldRow label="OPACITY">
                    <input
                      type="range" min={0} max={1} step={0.05}
                      value={refOpacity}
                      onChange={e => setRefOpacity(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: P.accent }}
                    />
                    <span style={{
                      fontSize: 9, color: P.muted,
                      width: 30, textAlign: 'right', flexShrink: 0,
                    }}>
                      {Math.round(refOpacity * 100)}%
                    </span>
                  </FieldRow>
                </>
              )}
            </Section>
          )}

        </div>

        {/* Footer: save */}
        <div style={{
          padding: '12px 14px', borderTop: `1px solid ${P.border}`,
          display: 'flex', gap: 8,
        }}>
          <button
            onClick={handleSave}
            disabled={!zone}
            style={{ ...btnStyle(isDirty ? P.warn : zone ? P.good : P.muted), flex: 1, opacity: zone ? 1 : 0.4 }}
          >
            {isDirty ? '● SAVE MAP' : 'SAVE MAP'}
          </button>
        </div>
      </div>

      {/* ── Canvas area ──────────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', background: P.bg }}>

        {/* Toolbar overlay */}
        <div style={{
          position: 'absolute', top: 12, left: 14, right: 14, zIndex: 1,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          pointerEvents: 'none',
        }}>
          {/* Left: map label */}
          <span style={{ fontSize: 10, color: P.muted, letterSpacing: 2 }}>
            {zone
              ? `${zone.name ?? zone.id}  ${zone.config?.width}×${zone.config?.height}`
              : 'NO MAP LOADED'}
          </span>

          {/* Right: action buttons + status */}
          <div style={{
            display: 'flex', gap: 5, alignItems: 'center',
            pointerEvents: 'auto',
          }}>
            <button
              onClick={undo}
              disabled={historyLen === 0}
              title="Undo (Ctrl+Z)"
              style={{ ...toolbarBtnStyle, opacity: historyLen > 0 ? 1 : 0.35 }}
            >
              ↩ UNDO
            </button>
            <button
              onClick={redo}
              disabled={futureLen === 0}
              title="Redo (Ctrl+Y)"
              style={{ ...toolbarBtnStyle, opacity: futureLen > 0 ? 1 : 0.35 }}
            >
              REDO ↪
            </button>
            <button
              onClick={() => setShowGrid(g => !g)}
              title="Toggle grid overlay"
              style={{
                ...toolbarBtnStyle,
                color:  showGrid ? P.accent : P.muted,
                border: `1px solid ${showGrid ? P.accent : P.border}`,
              }}
            >
              GRID
            </button>
            <button
              onClick={() => setDebugMode(d => !d)}
              title="Toggle raw tile view (no blending)"
              style={{
                ...toolbarBtnStyle,
                color:  debugMode ? P.warn : P.muted,
                border: `1px solid ${debugMode ? P.warn : P.border}`,
              }}
            >
              {debugMode ? 'RAW' : 'BLEND'}
            </button>
            <button
              onClick={() => setShowHeightDebug(d => !d)}
              title="Show height numbers on elevated tiles"
              style={{
                ...toolbarBtnStyle,
                color:  showHeightDebug ? P.accent : P.muted,
                border: `1px solid ${showHeightDebug ? P.accent : P.border}`,
              }}
            >
              H-NUM
            </button>
            <button
              onClick={() => setRotationAngle(a => (a + 1) % 4)}
              title={rotationAngle ? `Rotated ${rotationAngle * 90}° — editing disabled` : 'Rotate view (debug only)'}
              style={{
                ...toolbarBtnStyle,
                color:  rotationAngle ? P.warn : P.muted,
                border: `1px solid ${rotationAngle ? P.warn : P.border}`,
              }}
            >
              {rotationAngle ? `${rotationAngle * 90}°` : 'ROTATE'}
            </button>
            <button
              onClick={() => {
                if (showFOV && fovOrigin) {
                  setShowFOV(false); setFovOrigin(null);
                } else if (zone && hoveredTile) {
                  setFovOrigin({ x: hoveredTile.col, y: hoveredTile.row });
                  setShowFOV(true);
                } else {
                  setShowFOV(v => !v);
                }
              }}
              title={showFOV ? 'Click to clear FOV debug (shows vision from hovered tile)' : 'Hover a tile and click to show FOV from that position'}
              style={{
                ...toolbarBtnStyle,
                color:  showFOV ? '#f0d040' : P.muted,
                border: `1px solid ${showFOV ? '#f0d040' : P.border}`,
              }}
            >
              FOV
            </button>
            <button
              onClick={() => setEnableLighting(v => !v)}
              title="Toggle dynamic lighting (torches, darkness)"
              style={{
                ...toolbarBtnStyle,
                color:  enableLighting ? '#ffb840' : P.muted,
                border: `1px solid ${enableLighting ? '#ffb840' : P.border}`,
              }}
            >
              LIGHTS
            </button>
            {enableLighting && (
              <button
                onClick={() => setShowLightRadius(v => !v)}
                title="Show light radius debug circles"
                style={{
                  ...toolbarBtnStyle,
                  color:  showLightRadius ? '#ffb840' : P.muted,
                  border: `1px solid ${showLightRadius ? '#ffb840' : P.border}`,
                  fontSize: 8,
                }}
              >
                LRADIUS
              </button>
            )}
            <button
              onClick={() => setEnableCutaway(v => !v)}
              title="Enable wall cutaway when FOV origin is inside a building"
              style={{
                ...toolbarBtnStyle,
                color:  enableCutaway ? '#a0e0ff' : P.muted,
                border: `1px solid ${enableCutaway ? '#a0e0ff' : P.border}`,
              }}
            >
              CUTAWAY
            </button>
            <button
              onClick={() => setShowInteriorZones(v => !v)}
              title="Highlight interior tiles (flood-fill from edges)"
              style={{
                ...toolbarBtnStyle,
                color:  showInteriorZones ? '#b080ff' : P.muted,
                border: `1px solid ${showInteriorZones ? '#b080ff' : P.border}`,
              }}
            >
              INTERIOR
            </button>
            <button
              onClick={() => setPerfDebug(v => !v)}
              title="Toggle performance debug overlay"
              style={{
                ...toolbarBtnStyle,
                color:  perfDebug ? '#00ff88' : P.muted,
                border: `1px solid ${perfDebug ? '#00ff88' : P.border}`,
              }}
            >
              PERF
            </button>
            <button
              onClick={handleScreenshot}
              disabled={!zone}
              title="Export canvas as PNG"
              style={{ ...toolbarBtnStyle, opacity: zone ? 1 : 0.4 }}
            >
              EXPORT
            </button>

            <span style={{ fontSize: 10, color: P.muted, letterSpacing: 2, marginLeft: 4 }}>
              {editorMode === 'entity'
                ? `${zone?.entities?.length ?? 0} entities`
                : hoveredTile
                  ? `${hoveredTile.col},${hoveredTile.row}${editorMode === 'height' ? ` h:${getH(zone?.heights, hoveredTile.row, hoveredTile.col)}` : ''}`
                  : ''}
              {'  ·  '}{Math.round(camera.zoom * 100)}%
            </span>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            cursor: rotationAngle !== 0
              ? 'default'
              : (editorMode === 'entity' || editorMode === 'height' || isPainting)
                ? 'crosshair'
                : 'default',
            transform: rotationAngle ? `rotate(${rotationAngle * 90}deg)` : undefined,
            transformOrigin: '50% 50%',
            transition: 'transform 0.25s ease',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onContextMenu={e => e.preventDefault()}
        />

        {/* ── Performance debug overlay (content updated by RAF, no re-renders) ── */}
        {perfDebug && (
          <div
            ref={perfOverlayRef}
            style={{
              position: 'absolute', top: 48, left: 14,
              background: 'rgba(0,0,0,0.82)', color: '#aaa',
              padding: '8px 12px',
              fontFamily: 'monospace', fontSize: 11,
              lineHeight: 1.8, pointerEvents: 'none',
              zIndex: 8, minWidth: 160,
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          />
        )}

        {/* ── Loot popup overlay ────────────────────────────────────────────── */}
        {lootPopup && (
          <div style={{
            position: 'absolute', bottom: 28, left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10,10,16,0.97)',
            border: `1px solid ${P.accent}`,
            padding: '14px 20px',
            minWidth: 220, maxWidth: 320,
            zIndex: 10,
            pointerEvents: 'auto',
            boxShadow: `0 0 24px rgba(0,212,255,0.18)`,
          }}>
            <div style={{
              fontSize: 10, color: P.accent, letterSpacing: 3,
              marginBottom: 10,
              borderBottom: `1px solid ${P.border}`, paddingBottom: 7,
            }}>
              {lootPopup.title.toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {lootPopup.lines.map((line, i) => (
                <div key={i} style={{
                  fontFamily: 'monospace', fontSize: 13, color: P.text, letterSpacing: 1,
                }}>
                  {line}
                </div>
              ))}
            </div>
            <button
              onClick={() => setLootPopup(null)}
              style={{
                ...toolbarBtnStyle,
                marginTop: 12, width: '100%',
                fontSize: 9, letterSpacing: 3,
                color: P.accent, borderColor: P.accent,
              }}
            >
              CLOSE
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
