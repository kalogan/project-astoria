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

// ── Constants ──────────────────────────────────────────────────────────────────
const TW             = 64;
const TH             = 32;
const ISO_ORIGIN     = { x: 0, y: 0 };
const FALLBACK_ZONES = ['Cameron_Start', 'Cameron_Forest', 'zone_01', 'zone_02'];
const ZOOM_MIN       = 0.25;
const ZOOM_MAX       = 4;
const HISTORY_LIMIT  = 50;

// ── Entity palette ─────────────────────────────────────────────────────────────
const ENTITY_PALETTE = [
  { type: 'npc',       subtype: 'greeter',  label: 'NPC: Greeter',    color: '#4fc38a', icon: 'N', defaultConfig: { dialogue: 'intro_greeter' } },
  { type: 'npc',       subtype: 'merchant', label: 'NPC: Merchant',   color: '#f5c842', icon: 'N', defaultConfig: { shopId: '' } },
  { type: 'enemy',     subtype: 'slime',    label: 'Enemy: Slime',    color: '#e74c3c', icon: 'E', defaultConfig: { level: 1 } },
  { type: 'enemy',     subtype: 'skeleton', label: 'Enemy: Skeleton', color: '#c0392b', icon: 'E', defaultConfig: { level: 2 } },
  { type: 'spawn',     subtype: 'player',   label: 'Spawn Point',     color: '#3498db', icon: 'S', defaultConfig: {} },
  { type: 'structure', subtype: 'bridge',   label: 'Bridge',          color: '#a07840', icon: 'B', defaultConfig: { orientation: 'ew', length: '3' } },
  { type: 'structure', subtype: 'dock',     label: 'Dock',            color: '#8b6030', icon: 'D', defaultConfig: { orientation: 'south', length: '3' } },
  { type: 'structure', subtype: 'pier',     label: 'Pier',            color: '#7a5028', icon: 'P', defaultConfig: { orientation: 'south', length: '5' } },
];

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

function drawMapCanvas(canvas, zone, hoveredTile, camera, config, selectedEntityId, editorMode, overlayOpts) {
  const {
    refImage = null, refOpacity = 0.4, refVisible = false,
    showGrid = false, debugMode = false,
    heights = null, showHeightDebug = false,
    waterFlow = null, animOffset = 0,
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
  const cols                 = tiles[0].length;

  // Height-aware painter's algorithm sort:
  // tiles at the same (r+c) diagonal are ordered by elevation (lower first)
  // so taller tiles always paint over shorter tiles on the same diagonal.
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

  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);

  // ── 1. Tiles ─────────────────────────────────────────────────────────────────
  const splashList = []; // collected during tile loop, drawn in pass 3

  for (const [r, c] of cells) {
    const type   = tiles[r][c];
    const h      = getH(heights, r, c);
    const { x: sx, y: syBase } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
    const sy     = syBase - h * HEIGHT_SCALE;
    const cliffR = Math.max(0, h - getH(heights, r,     c + 1)) * HEIGHT_SCALE;
    const cliffL = Math.max(0, h - getH(heights, r + 1, c    )) * HEIGHT_SCALE;

    if (isWaterTile(type)) {
      drawWaterTile(ctx, sx, sy, TW, TH, r, c, tiles, heights, waterFlow,
                    animOffset, cliffR, cliffL);
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

  ctx.restore();

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
    const def = getEntityDef(entity);
    const isSelected = entity.id === selectedEntityId;

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
  const [editorMode, setEditorMode] = useState('tile'); // 'tile' | 'entity'

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
  const animOffsetRef        = useRef(0);   // ever-increasing time for water animation
  const animRafRef           = useRef(null);
  const drawOptsRef          = useRef(null); // latest draw params for RAF loop

  useEffect(() => { cameraRef.current            = camera; },           [camera]);
  useEffect(() => { zoneRef.current              = zone; },             [zone]);
  useEffect(() => { editorModeRef.current        = editorMode; },       [editorMode]);
  useEffect(() => { isPaintingRef.current        = isPainting; },       [isPainting]);
  useEffect(() => { selectedTileTypeRef.current  = selectedTileType; }, [selectedTileType]);
  useEffect(() => { selectedEntityDefRef.current = selectedEntityDef; },[selectedEntityDef]);
  useEffect(() => { brushToolRef.current         = brushTool; },        [brushTool]);
  useEffect(() => { brushSizeRef.current         = brushSize; },        [brushSize]);
  useEffect(() => { rotationAngleRef.current     = rotationAngle; },    [rotationAngle]);
  useEffect(() => { selectedFlowDirRef.current  = selectedFlowDir; },  [selectedFlowDir]);

  // ── Keep draw opts mirror current on every render (for RAF loop) ─────────────
  useLayoutEffect(() => {
    drawOptsRef.current = {
      zone, hoveredTile, camera, config, selectedEntityId, editorMode,
      overlayOpts: {
        refImage, refOpacity, refVisible, showGrid, debugMode,
        heights:        zone?.heights   ?? null,
        showHeightDebug,
        waterFlow:      zone?.waterFlow ?? null,
      },
    };
  }); // no deps — runs after every render

  // ── Water animation RAF loop ─────────────────────────────────────────────────
  // Continuously redraws the canvas (with advancing animOffset) only when the
  // zone contains water tiles.  Non-water maps pay essentially zero cost.
  useEffect(() => {
    let lastTime = performance.now();
    const tick = (now) => {
      const dt  = Math.min((now - lastTime) / 1000, 0.05);
      lastTime  = now;

      const hasWater = zoneRef.current?.tiles?.some(row => row.some(t => t === WATER_TYPE));
      if (hasWater) {
        animOffsetRef.current += dt * 0.35;
        const canvas = canvasRef.current;
        const opts   = drawOptsRef.current;
        if (canvas && opts?.zone) {
          drawMapCanvas(
            canvas, opts.zone, opts.hoveredTile, opts.camera, opts.config,
            opts.selectedEntityId, opts.editorMode,
            { ...opts.overlayOpts, animOffset: animOffsetRef.current },
          );
        }
      }
      animRafRef.current = requestAnimationFrame(tick);
    };
    animRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRafRef.current);
  }, []); // empty — RAF always runs, but only draws when water present

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
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawMapCanvas(
      canvas, zone, hoveredTile, camera, config,
      selectedEntityId, editorMode,
      {
        refImage, refOpacity, refVisible, showGrid, debugMode,
        heights:        zone?.heights   ?? null, showHeightDebug,
        waterFlow:      zone?.waterFlow ?? null,
        animOffset:     animOffsetRef.current,
      },
    );
  }, [zone, hoveredTile, camera, config, selectedEntityId, editorMode,
      refImage, refOpacity, refVisible, showGrid, debugMode, showHeightDebug]);

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
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

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
    setZone(prev => { if (!prev) return prev; const next = deepClone(prev); next[field] = value; return next; });
    setIsDirty(true);
  }, []);

  const setConfigField = useCallback((field, value) => {
    setZone(prev => { if (!prev) return prev; const next = deepClone(prev); next.config[field] = value; return next; });
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
      const next = deepClone(prev);
      if (!Array.isArray(next.entities)) next.entities = [];
      next.entities.push(newEntity);
      return next;
    });
    setSelectedEntityId(id);
    setIsDirty(true);
  }, []);

  const deleteEntity = useCallback((id) => {
    commitHistory();
    setZone(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      next.entities = (next.entities ?? []).filter(e => e.id !== id);
      return next;
    });
    setSelectedEntityId(null);
    setIsDirty(true);
  }, [commitHistory]);

  const updateEntity = useCallback((id, updates) => {
    setZone(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      const idx  = next.entities.findIndex(e => e.id === id);
      if (idx === -1) return prev;
      next.entities[idx] = { ...next.entities[idx], ...updates };
      return next;
    });
    setIsDirty(true);
  }, []);

  const updateEntityConfig = useCallback((id, key, value) => {
    setZone(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      const idx  = next.entities.findIndex(e => e.id === id);
      if (idx === -1) return prev;
      next.entities[idx] = {
        ...next.entities[idx],
        config: { ...next.entities[idx].config, [key]: value },
      };
      return next;
    });
    setIsDirty(true);
  }, []);

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
  }, [hitTest, applyTileTool, placeEntity, commitHistory, adjustHeight]);

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
  }, [hitTest, applyTileTool, adjustHeight]);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPainting(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    setIsPainting(false);
    setHovered(null);
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
    setHovered(null);
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

        {/* Mode toggle */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${P.border}`, flexShrink: 0 }}>
          {[['tile', 'TILE'], ['height', 'HEIGHT'], ['entity', 'ENTITY']].map(([mode, label]) => {
            const active = editorMode === mode;
            return (
              <button key={mode} onClick={() => switchMode(mode)} style={{
                flex: 1, background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: 'none', borderBottom: `2px solid ${active ? P.accent : 'transparent'}`,
                color: active ? P.accent : P.muted,
                fontFamily: 'monospace', fontSize: 9, letterSpacing: 1,
                padding: '10px 0', cursor: 'pointer',
              }}>
                {label}
              </button>
            );
          })}
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
      </div>
    </div>
  );
}
