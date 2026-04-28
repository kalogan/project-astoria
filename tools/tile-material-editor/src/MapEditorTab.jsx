import React, { useRef, useEffect, useCallback, useState } from 'react';
import { P, TILE_TYPES, TILE_LABELS, deepClone, pickTileColor, drawIsoTile, btnStyle } from './constants';
import { gridToScreen, screenToGrid } from './isoUtils';

// ── Constants ─────────────────────────────────────────────────────────────────
const TW = 64;   // base tile width in world space
const TH = 32;   // base tile height (TW * 0.5)
const ISO_ORIGIN = { x: 0, y: 0 };
const FALLBACK_ZONES = ['Cameron_Start', 'Cameron_Forest', 'zone_01', 'zone_02'];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

// ── Camera helpers ─────────────────────────────────────────────────────────────

function getInitialCamera(zone, canvasW, canvasH) {
  const rows = zone.tiles.length;
  const cols = zone.tiles[0].length;

  // Bounding box of all four map corners in world space
  const corners = [
    gridToScreen(0,      0,      ISO_ORIGIN, TW, TH),
    gridToScreen(0,      cols-1, ISO_ORIGIN, TW, TH),
    gridToScreen(rows-1, 0,      ISO_ORIGIN, TW, TH),
    gridToScreen(rows-1, cols-1, ISO_ORIGIN, TW, TH),
  ];
  const minX  = Math.min(...corners.map(c => c.x)) - TW;
  const maxX  = Math.max(...corners.map(c => c.x)) + TW;
  const minY  = Math.min(...corners.map(c => c.y)) - TH * 4; // headroom for walls
  const maxY  = Math.max(...corners.map(c => c.y)) + TH * 2;

  const zoom = Math.min(
    (canvasW * 0.88) / (maxX - minX),
    (canvasH * 0.88) / (maxY - minY),
    2,
  );

  const centerWorldX = (minX + maxX) / 2;
  const centerWorldY = (minY + maxY) / 2;

  return {
    zoom,
    panX: canvasW / 2 - centerWorldX * zoom,
    panY: canvasH / 2 - centerWorldY * zoom,
  };
}

// ── Canvas draw ────────────────────────────────────────────────────────────────

function drawMapCanvas(canvas, zone, hoveredTile, camera, config) {
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  if (!zone) {
    ctx.fillStyle  = P.muted;
    ctx.font       = '11px monospace';
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SELECT A MAP OR CREATE A NEW ONE', W / 2, H / 2);
    return;
  }

  const { panX, panY, zoom } = camera;
  const { tiles } = zone;
  const rows = tiles.length;
  const cols = tiles[0].length;

  // Sort back-to-front (painter's algorithm)
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (tiles[r][c] !== 0) cells.push([r, c]);
  cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));

  // Draw tiles in world space via camera transform
  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);

  for (const [r, c] of cells) {
    const type     = tiles[r][c];
    const { x: sx, y: sy } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
    const topColor = pickTileColor(type, r, c, tiles, config);
    drawIsoTile(ctx, sx, sy, TW, TH, topColor, type, config);
  }

  ctx.restore();

  // Hover highlight drawn in screen space so stroke width stays constant
  if (hoveredTile) {
    const { row, col } = hoveredTile;
    const { x: wx, y: wy } = gridToScreen(row, col, ISO_ORIGIN, TW, TH);
    const sx  = wx * zoom + panX;
    const sy  = wy * zoom + panY;
    const sHW = TW * zoom * 0.5;
    const sHH = TH * zoom * 0.5;
    const sTH = TH * zoom;

    ctx.save();
    // Subtle fill
    ctx.beginPath();
    ctx.moveTo(sx,        sy);
    ctx.lineTo(sx - sHW,  sy + sHH);
    ctx.lineTo(sx,        sy + sTH);
    ctx.lineTo(sx + sHW,  sy + sHH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 212, 255, 0.18)';
    ctx.fill();
    // Diamond outline
    ctx.strokeStyle = P.accent;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  }
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

function FieldRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: P.muted, letterSpacing: 1, width: 44, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}

const inputStyle = {
  background: P.bg, border: `1px solid ${P.border}`, color: P.text,
  fontFamily: 'monospace', fontSize: 11, padding: '4px 7px', width: '100%',
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function MapEditorTab({ config }) {
  const [zoneList,          setZoneList]    = useState([]);
  const [zone,              setZone]        = useState(null);
  const [currentMapId,      setCurrentMapId] = useState(null);
  const [selectedTileType,  setSelected]    = useState(TILE_TYPES.FLOOR);
  const [hoveredTile,       setHovered]     = useState(null);
  const [camera,            setCamera]      = useState({ panX: 0, panY: 0, zoom: 1 });
  const [isPainting,        setIsPainting]  = useState(false);
  const [isDirty,           setIsDirty]     = useState(false);
  const [loadError,         setLoadError]   = useState(null);

  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Keep refs in sync with state for use inside event handlers
  const cameraRef          = useRef(camera);
  const zoneRef            = useRef(zone);
  const isPaintingRef      = useRef(isPainting);
  const selectedTypeRef    = useRef(selectedTileType);
  useEffect(() => { cameraRef.current       = camera; },          [camera]);
  useEffect(() => { zoneRef.current         = zone; },            [zone]);
  useEffect(() => { isPaintingRef.current   = isPainting; },      [isPainting]);
  useEffect(() => { selectedTypeRef.current = selectedTileType; }, [selectedTileType]);

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
    drawMapCanvas(canvas, zone, hoveredTile, camera, config);
  }, [zone, hoveredTile, camera, config]);

  // ── Center camera when a new map is loaded ─────────────────────────────────
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
    const w  = 15, h = 15;
    const newZone = {
      id,
      name: 'New Map',
      config: { width: w, height: h, seed: Date.now() },
      playerStart: { x: 0, z: 0 },
      tiles: Array.from({ length: h }, () => Array(w).fill(TILE_TYPES.WALL)),
      entities: [],
      systems: { keys: [], doors: [], enemies: [], portals: [], quests: [] },
    };
    setZone(newZone);
    setCurrentMapId(id);
    setIsDirty(false);
    setLoadError(null);
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
    setZone(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      next[field] = value;
      return next;
    });
    setIsDirty(true);
  }, []);

  const setConfigField = useCallback((field, value) => {
    setZone(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      next.config[field] = value;
      return next;
    });
    setIsDirty(true);
  }, []);

  // ── Tile painting ─────────────────────────────────────────────────────────
  const paintTile = useCallback((row, col) => {
    setZone(prev => {
      if (!prev) return prev;
      if (prev.tiles[row][col] === selectedTypeRef.current) return prev;
      const next = deepClone(prev);
      next.tiles[row][col] = selectedTypeRef.current;
      return next;
    });
    setIsDirty(true);
  }, []);

  // ── Hit-test helper ────────────────────────────────────────────────────────
  const hitTest = useCallback((mouseX, mouseY) => {
    const z = zoneRef.current;
    if (!z) return null;
    const cam   = cameraRef.current;
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
      isPanningRef.current  = true;
      lastMouseRef.current  = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) {
      const tile = hitTest(mx, my);
      if (tile) {
        paintTile(tile.row, tile.col);
        setIsPainting(true);
      } else {
        isPanningRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      }
    }
  }, [hitTest, paintTile]);

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

    if (isPaintingRef.current && tile) {
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

  // Wheel must be non-passive to call preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e) => {
      e.preventDefault();
      const rect    = canvas.getBoundingClientRect();
      const mx      = e.clientX - rect.left;
      const my      = e.clientY - rect.top;
      const factor  = e.deltaY < 0 ? 1.1 : 1 / 1.1;

      setCamera(prev => {
        const newZoom  = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.zoom * factor));
        const worldX   = (mx - prev.panX) / prev.zoom;
        const worldY   = (my - prev.panY) / prev.zoom;
        return {
          zoom: newZoom,
          panX: mx - worldX * newZoom,
          panY: my - worldY * newZoom,
        };
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  const tileTypeEntries = Object.entries(TILE_TYPES); // [['FLOOR',1],['WALL',2],['ROAD',3]]

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* ── Left panel ──────────────────────────────────────────────────────── */}
      <div style={{
        width: 260, flexShrink: 0, background: P.panel,
        borderRight: `1px solid ${P.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 16px',
          display: 'flex', flexDirection: 'column', gap: 22,
        }}>

          {/* Map list */}
          <Section title="MAPS">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {zoneList.map(id => (
                <button
                  key={id}
                  onClick={() => loadZoneById(id)}
                  style={{
                    ...btnStyle(id === currentMapId ? P.accent : P.muted),
                    textAlign: 'left', fontSize: 10, letterSpacing: 1,
                    padding: '6px 10px',
                    background: id === currentMapId ? 'rgba(0,212,255,0.07)' : 'transparent',
                  }}
                >
                  {id}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleNewMap} style={{ ...btnStyle(P.accent), flex: 1, fontSize: 10, padding: '6px 10px' }}>
                + NEW MAP
              </button>
              <button onClick={() => fileInputRef.current?.click()} style={{ ...btnStyle(P.muted), fontSize: 10, padding: '6px 10px' }}>
                UPLOAD
              </button>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileUpload} />
            </div>
            {loadError && (
              <div style={{ fontSize: 10, color: P.warn, letterSpacing: 1 }}>{loadError}</div>
            )}
          </Section>

          {/* Map config — only shown when a map is loaded */}
          {zone && (
            <Section title="MAP CONFIG">
              <FieldRow label="NAME">
                <input
                  style={inputStyle} value={zone.name ?? ''}
                  onChange={e => setMapField('name', e.target.value)}
                />
              </FieldRow>
              <FieldRow label="ID">
                <input style={{ ...inputStyle, color: P.muted }} value={zone.id ?? ''} readOnly />
              </FieldRow>
              <div style={{ display: 'flex', gap: 6 }}>
                <FieldRow label="W">
                  <input
                    style={{ ...inputStyle, width: 48 }} type="number" min={1} max={64}
                    value={zone.config?.width ?? 15}
                    onChange={e => setConfigField('width', parseInt(e.target.value) || 15)}
                  />
                </FieldRow>
                <FieldRow label="H">
                  <input
                    style={{ ...inputStyle, width: 48 }} type="number" min={1} max={64}
                    value={zone.config?.height ?? 15}
                    onChange={e => setConfigField('height', parseInt(e.target.value) || 15)}
                  />
                </FieldRow>
              </div>
              <FieldRow label="SEED">
                <input
                  style={inputStyle} type="number"
                  value={zone.config?.seed ?? 0}
                  onChange={e => setConfigField('seed', parseInt(e.target.value) || 0)}
                />
              </FieldRow>
            </Section>
          )}

          {/* Tile palette */}
          <Section title="TILE PALETTE">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tileTypeEntries.map(([key, typeId]) => {
                const isSelected = selectedTileType === typeId;
                const swatchColor = config.pal[typeId]?.[0] ?? '#808080';
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(typeId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: isSelected ? 'rgba(0,212,255,0.1)' : 'transparent',
                      border: `1px solid ${isSelected ? P.accent : P.border}`,
                      padding: '7px 10px', cursor: 'pointer', width: '100%',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, background: swatchColor,
                      border: `1px solid ${P.border}`, flexShrink: 0, display: 'block',
                    }}/>
                    <span style={{
                      fontFamily: 'monospace', fontSize: 10,
                      color: isSelected ? P.accent : P.muted,
                      letterSpacing: 2,
                    }}>
                      {TILE_LABELS[typeId].toUpperCase()}
                    </span>
                    {isSelected && (
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: P.accent, letterSpacing: 1 }}>
                        ACTIVE
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 9, color: P.muted, letterSpacing: 1, lineHeight: 1.6 }}>
              CLICK or DRAG to paint<br/>
              SCROLL to zoom · MIDDLE-DRAG to pan
            </div>
          </Section>

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${P.border}`, display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={!zone}
            style={{
              ...btnStyle(isDirty ? P.warn : zone ? P.good : P.muted),
              flex: 1, opacity: zone ? 1 : 0.4,
            }}
          >
            {isDirty ? '● SAVE MAP' : 'SAVE MAP'}
          </button>
        </div>
      </div>

      {/* ── Canvas area ─────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: P.bg }}
      >
        {/* Status bar */}
        <div style={{
          position: 'absolute', top: 12, left: 14, right: 14,
          display: 'flex', justifyContent: 'space-between', pointerEvents: 'none', zIndex: 1,
        }}>
          <span style={{ fontSize: 10, color: P.muted, letterSpacing: 2 }}>
            {zone ? `${zone.name ?? zone.id}  ${zone.config?.width}×${zone.config?.height}` : 'NO MAP LOADED'}
          </span>
          <span style={{ fontSize: 10, color: P.muted, letterSpacing: 2 }}>
            {hoveredTile ? `${hoveredTile.col}, ${hoveredTile.row}` : ''}
            {hoveredTile ? `  ·  ${Math.round(camera.zoom * 100)}%` : `${Math.round(camera.zoom * 100)}%`}
          </span>
        </div>

        <canvas
          ref={canvasRef}
          style={{ display: 'block', cursor: isPainting ? 'crosshair' : 'default' }}
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
