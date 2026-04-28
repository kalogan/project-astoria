import React, { useRef, useEffect, useCallback, useState } from 'react';
import { P, TILE_TYPES, TILE_LABELS, deepClone, pickTileColor, drawIsoTile, btnStyle } from './constants';
import { gridToScreen, screenToGrid, gridToWorld, worldToGrid } from './isoUtils';

// ── Constants ─────────────────────────────────────────────────────────────────
const TW = 64;
const TH = 32;
const ISO_ORIGIN   = { x: 0, y: 0 };
const FALLBACK_ZONES = ['Cameron_Start', 'Cameron_Forest', 'zone_01', 'zone_02'];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

// ── Entity palette ─────────────────────────────────────────────────────────────
// Each entry defines a placeable entity type.  `defaultConfig` seeds the
// entity's config object when first placed.

const ENTITY_PALETTE = [
  { type: 'npc',   subtype: 'greeter',  label: 'NPC: Greeter',    color: '#4fc38a', icon: 'N', defaultConfig: { dialogue: 'intro_greeter' } },
  { type: 'npc',   subtype: 'merchant', label: 'NPC: Merchant',   color: '#f5c842', icon: 'N', defaultConfig: { shopId: '' } },
  { type: 'enemy', subtype: 'slime',    label: 'Enemy: Slime',    color: '#e74c3c', icon: 'E', defaultConfig: { level: 1 } },
  { type: 'enemy', subtype: 'skeleton', label: 'Enemy: Skeleton', color: '#c0392b', icon: 'E', defaultConfig: { level: 2 } },
  { type: 'spawn', subtype: 'player',   label: 'Spawn Point',     color: '#3498db', icon: 'S', defaultConfig: {} },
];

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
// Returns the first entity whose marker circle contains (mouseX, mouseY).

function entityHitTest(mouseX, mouseY, zone, camera) {
  if (!zone?.entities?.length) return null;
  const { panX, panY, zoom } = camera;
  const rows = zone.tiles.length;
  const cols = zone.tiles[0].length;
  const HIT_R = 13; // fixed pixel radius — matches the drawn circle

  for (const entity of zone.entities) {
    const grid = worldToGrid(entity.position.x, entity.position.y, rows, cols);
    const { x: wx, y: wy } = gridToScreen(grid.row, grid.col, ISO_ORIGIN, TW, TH);
    const sx = wx * zoom + panX;
    const sy = (wy + TH / 2) * zoom + panY;
    if (Math.hypot(mouseX - sx, mouseY - sy) <= HIT_R) return entity;
  }
  return null;
}

// ── Canvas draw ────────────────────────────────────────────────────────────────

function drawMapCanvas(canvas, zone, hoveredTile, camera, config, selectedEntityId, editorMode) {
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
  const { tiles } = zone;
  const rows = tiles.length;
  const cols = tiles[0].length;

  // ── Tiles (world space, back-to-front) ──────────────────────────────────────
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (tiles[r][c] !== 0) cells.push([r, c]);
  cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));

  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
  for (const [r, c] of cells) {
    const type     = tiles[r][c];
    const { x: sx, y: sy } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
    drawIsoTile(ctx, sx, sy, TW, TH, pickTileColor(type, r, c, tiles, config), type, config);
  }
  ctx.restore();

  // ── Hover highlight (screen space, constant stroke) ─────────────────────────
  if (hoveredTile) {
    const { row, col } = hoveredTile;
    const { x: wx, y: wy } = gridToScreen(row, col, ISO_ORIGIN, TW, TH);
    const sx  = wx * zoom + panX;
    const sy  = wy * zoom + panY;
    const sHW = TW * zoom * 0.5;
    const sHH = TH * zoom * 0.5;
    const sTH = TH * zoom;
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
    ctx.restore();
  }

  // ── Entity markers (screen space) ───────────────────────────────────────────
  const entities = zone.entities ?? [];
  if (entities.length === 0) return;

  const MARKER_R = 9;
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 9px monospace';

  for (const entity of entities) {
    const grid = worldToGrid(entity.position.x, entity.position.y, rows, cols);
    const { x: wx, y: wy } = gridToScreen(grid.row, grid.col, ISO_ORIGIN, TW, TH);
    const sx = wx * zoom + panX;
    const sy = (wy + TH / 2) * zoom + panY; // centre of top-face diamond

    const def      = getEntityDef(entity);
    const isSelected = entity.id === selectedEntityId;

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(sx, sy, MARKER_R + 5, 0, Math.PI * 2);
      ctx.strokeStyle = P.accent;
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // Drop shadow
    ctx.beginPath();
    ctx.arc(sx + 1, sy + 1, MARKER_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    // Filled circle
    ctx.beginPath();
    ctx.arc(sx, sy, MARKER_R, 0, Math.PI * 2);
    ctx.fillStyle   = def.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Icon letter
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

const selectStyle = {
  ...inputStyle, padding: '3px 6px', cursor: 'pointer',
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function MapEditorTab({ config }) {
  // ── Map state ──────────────────────────────────────────────────────────────
  const [zoneList,     setZoneList]     = useState([]);
  const [zone,         setZone]         = useState(null);
  const [currentMapId, setCurrentMapId] = useState(null);
  const [isDirty,      setIsDirty]      = useState(false);
  const [loadError,    setLoadError]    = useState(null);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const [camera, setCamera] = useState({ panX: 0, panY: 0, zoom: 1 });

  // ── Editor mode ────────────────────────────────────────────────────────────
  const [editorMode, setEditorMode] = useState('tile'); // 'tile' | 'entity'

  // ── Tile mode state ────────────────────────────────────────────────────────
  const [selectedTileType, setSelectedTileType] = useState(TILE_TYPES.FLOOR);
  const [hoveredTile,      setHovered]          = useState(null);
  const [isPainting,       setIsPainting]       = useState(false);

  // ── Entity mode state ──────────────────────────────────────────────────────
  const [selectedEntityDef, setSelectedEntityDef] = useState(ENTITY_PALETTE[0]);
  const [selectedEntityId,  setSelectedEntityId]  = useState(null);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Sync mutable values into refs so stable callbacks can read current values
  const cameraRef           = useRef(camera);
  const zoneRef             = useRef(zone);
  const editorModeRef       = useRef(editorMode);
  const isPaintingRef       = useRef(isPainting);
  const selectedTileTypeRef = useRef(selectedTileType);
  const selectedEntityDefRef= useRef(selectedEntityDef);

  useEffect(() => { cameraRef.current            = camera; },           [camera]);
  useEffect(() => { zoneRef.current              = zone; },             [zone]);
  useEffect(() => { editorModeRef.current        = editorMode; },       [editorMode]);
  useEffect(() => { isPaintingRef.current        = isPainting; },       [isPainting]);
  useEffect(() => { selectedTileTypeRef.current  = selectedTileType; }, [selectedTileType]);
  useEffect(() => { selectedEntityDefRef.current = selectedEntityDef; },[selectedEntityDef]);

  // ── Canvas resize ──────────────────────────────────────────────────────────
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

  // ── Canvas redraw ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawMapCanvas(canvas, zone, hoveredTile, camera, config, selectedEntityId, editorMode);
  }, [zone, hoveredTile, camera, config, selectedEntityId, editorMode]);

  // ── Center camera on new map load ──────────────────────────────────────────
  useEffect(() => {
    if (!zone || !canvasRef.current) return;
    const { width, height } = canvasRef.current;
    if (!width || !height) return;
    setCamera(getInitialCamera(zone, width, height));
  }, [currentMapId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zone list fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/zones/index.json')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setZoneList(Array.isArray(data) ? data : FALLBACK_ZONES))
      .catch(() => setZoneList(FALLBACK_ZONES));
  }, []);

  // ── Zone load ──────────────────────────────────────────────────────────────
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
    } catch (err) {
      setLoadError(`Could not load "${id}": ${err.message}`);
    }
  }, []);

  // ── File upload ────────────────────────────────────────────────────────────
  const fileInputRef = useRef(null);

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
      } catch {
        setLoadError('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ── New map ────────────────────────────────────────────────────────────────
  const handleNewMap = useCallback(() => {
    const id = `map_${Date.now()}`;
    const w = 15, h = 15;
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
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!zone) return;
    const blob = new Blob([JSON.stringify(zone, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${zone.id}.json`; a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
  }, [zone]);

  // ── Map config edits ───────────────────────────────────────────────────────
  const setMapField = useCallback((field, value) => {
    setZone(prev => { if (!prev) return prev; const next = deepClone(prev); next[field] = value; return next; });
    setIsDirty(true);
  }, []);

  const setConfigField = useCallback((field, value) => {
    setZone(prev => { if (!prev) return prev; const next = deepClone(prev); next.config[field] = value; return next; });
    setIsDirty(true);
  }, []);

  // ── Tile painting ─────────────────────────────────────────────────────────
  const paintTile = useCallback((row, col) => {
    setZone(prev => {
      if (!prev) return prev;
      if (prev.tiles[row][col] === selectedTileTypeRef.current) return prev;
      const next = deepClone(prev);
      next.tiles[row][col] = selectedTileTypeRef.current;
      return next;
    });
    setIsDirty(true);
  }, []);

  // ── Entity CRUD ────────────────────────────────────────────────────────────
  const placeEntity = useCallback((row, col) => {
    const z   = zoneRef.current;
    if (!z) return;
    const rows = z.tiles.length;
    const cols = z.tiles[0].length;
    const def  = selectedEntityDefRef.current;
    const id   = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newEntity = {
      id,
      type:     def.type,
      subtype:  def.subtype,
      position: gridToWorld(row, col, rows, cols), // { x, y } world space
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
    setZone(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      next.entities = (next.entities ?? []).filter(e => e.id !== id);
      return next;
    });
    setSelectedEntityId(null);
    setIsDirty(true);
  }, []);

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

  // ── Hit-test (grid) ────────────────────────────────────────────────────────
  const hitTest = useCallback((mouseX, mouseY) => {
    const z = zoneRef.current;
    if (!z) return null;
    const cam    = cameraRef.current;
    const worldX = (mouseX - cam.panX) / cam.zoom;
    const worldY = (mouseY - cam.panY) / cam.zoom;
    return screenToGrid(worldX, worldY, ISO_ORIGIN, TW, TH, z.tiles.length, z.tiles[0].length);
  }, []);

  // ── Mouse events ───────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    if (e.button === 1) {
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 0) {
      if (editorModeRef.current === 'entity') {
        // Try to select an existing entity marker first
        const hit = entityHitTest(mx, my, zoneRef.current, cameraRef.current);
        if (hit) {
          setSelectedEntityId(hit.id);
          return;
        }
        // Click on empty tile → place new entity
        const tile = hitTest(mx, my);
        if (tile) {
          placeEntity(tile.row, tile.col);
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }
      } else {
        // Tile mode: paint or pan
        const tile = hitTest(mx, my);
        if (tile) {
          paintTile(tile.row, tile.col);
          setIsPainting(true);
        } else {
          isPanningRef.current = true;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
        }
      }
    }
  }, [hitTest, paintTile, placeEntity]);

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

    // Drag-paint only in tile mode
    if (editorModeRef.current === 'tile' && isPaintingRef.current && tile) {
      paintTile(tile.row, tile.col);
    }
  }, [hitTest, paintTile]);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPainting(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    setIsPainting(false);
    setHovered(null);
  }, []);

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

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedEntity = zone?.entities?.find(e => e.id === selectedEntityId) ?? null;
  const tileTypeEntries = Object.entries(TILE_TYPES);

  // ── Mode switch helper ─────────────────────────────────────────────────────
  const switchMode = useCallback((mode) => {
    setEditorMode(mode);
    setSelectedEntityId(null);
    setHovered(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* ── Left panel ──────────────────────────────────────────────────────── */}
      <div style={{
        width: 264, flexShrink: 0, background: P.panel,
        borderRight: `1px solid ${P.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Mode toggle (always visible, above scroll area) */}
        <div style={{
          display: 'flex', gap: 0,
          borderBottom: `1px solid ${P.border}`, flexShrink: 0,
        }}>
          {[['tile', 'TILE MODE'], ['entity', 'ENTITY MODE']].map(([mode, label]) => {
            const active = editorMode === mode;
            return (
              <button key={mode} onClick={() => switchMode(mode)} style={{
                flex: 1, background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: 'none', borderBottom: `2px solid ${active ? P.accent : 'transparent'}`,
                color: active ? P.accent : P.muted,
                fontFamily: 'monospace', fontSize: 9, letterSpacing: 2,
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

          {/* ── Maps ────────────────────────────────────────────────────── */}
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
              <button onClick={handleNewMap} style={{ ...btnStyle(P.accent), flex: 1, fontSize: 10, padding: '6px 8px' }}>
                + NEW MAP
              </button>
              <button onClick={() => fileInputRef.current?.click()} style={{ ...btnStyle(P.muted), fontSize: 10, padding: '6px 8px' }}>
                UPLOAD
              </button>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileUpload} />
            </div>
            {loadError && <div style={{ fontSize: 10, color: P.warn, letterSpacing: 1 }}>{loadError}</div>}
          </Section>

          {/* ── Map config ───────────────────────────────────────────────── */}
          {zone && (
            <Section title="MAP CONFIG">
              <FieldRow label="NAME">
                <input style={inputStyle} value={zone.name ?? ''} onChange={e => setMapField('name', e.target.value)} />
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

          {/* ── TILE MODE: palette ───────────────────────────────────────── */}
          {editorMode === 'tile' && (
            <Section title="TILE PALETTE">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {tileTypeEntries.map(([key, typeId]) => {
                  const active = selectedTileType === typeId;
                  const swatch = config.pal[typeId]?.[0] ?? '#808080';
                  return (
                    <button key={key} onClick={() => setSelectedTileType(typeId)} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
                      border: `1px solid ${active ? P.accent : P.border}`,
                      padding: '7px 10px', cursor: 'pointer', width: '100%',
                    }}>
                      <span style={{ width: 16, height: 16, background: swatch, border: `1px solid ${P.border}`, flexShrink: 0 }}/>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: active ? P.accent : P.muted, letterSpacing: 2 }}>
                        {TILE_LABELS[typeId].toUpperCase()}
                      </span>
                      {active && <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent }}>ACTIVE</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.6 }}>
                CLICK or DRAG to paint<br/>SCROLL to zoom · MIDDLE-DRAG to pan
              </div>
            </Section>
          )}

          {/* ── ENTITY MODE: palette ─────────────────────────────────────── */}
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
                          background: def.color, flexShrink: 0, display: 'block',
                          boxShadow: `0 0 0 1.5px rgba(255,255,255,0.2)`,
                        }}/>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: active ? P.accent : P.muted, letterSpacing: 1 }}>
                          {def.label.toUpperCase()}
                        </span>
                        {active && <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent }}>ACTIVE</span>}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.6 }}>
                  CLICK tile to place · CLICK marker to select<br/>SCROLL to zoom · MIDDLE-DRAG to pan
                </div>
              </Section>

              {/* ── Entity editor ──────────────────────────────────────── */}
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

                  {/* Dynamic config fields */}
                  {Object.entries(selectedEntity.config ?? {}).map(([key, val]) => (
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

        </div>

        {/* ── Footer: save ────────────────────────────────────────────────── */}
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${P.border}`, display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={!zone}
            style={{ ...btnStyle(isDirty ? P.warn : zone ? P.good : P.muted), flex: 1, opacity: zone ? 1 : 0.4 }}
          >
            {isDirty ? '● SAVE MAP' : 'SAVE MAP'}
          </button>
        </div>
      </div>

      {/* ── Canvas area ─────────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', background: P.bg }}>

        {/* Status bar */}
        <div style={{
          position: 'absolute', top: 12, left: 14, right: 14, zIndex: 1,
          display: 'flex', justifyContent: 'space-between', pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 10, color: P.muted, letterSpacing: 2 }}>
            {zone ? `${zone.name ?? zone.id}  ${zone.config?.width}×${zone.config?.height}` : 'NO MAP LOADED'}
          </span>
          <span style={{ fontSize: 10, color: P.muted, letterSpacing: 2 }}>
            {editorMode === 'entity'
              ? `${zone?.entities?.length ?? 0} entities`
              : hoveredTile ? `${hoveredTile.col}, ${hoveredTile.row}` : ''}
            {'  ·  '}{Math.round(camera.zoom * 100)}%
          </span>
        </div>

        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            cursor: editorMode === 'entity' ? 'crosshair' : isPainting ? 'crosshair' : 'default',
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
