import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  P, DEFAULT_CONFIG, TILE_LABELS, T_LABELS,
  deepClone, mulberry32, darken, lighten, btnStyle,
} from './constants';

// ── Isometric preview renderer ────────────────────────────────────────────────
// Fixed 9×9 layout used only for the material preview.
// Uses sequential mulberry32 RNG (not the game hash) — intentional, this is
// just a visual swatch, not a zone render.

function buildPreviewMap() {
  return [
    [1,1,1,1,1,1,1,1,1],
    [1,0,0,0,2,0,0,0,1],
    [1,0,0,0,2,0,0,0,1],
    [1,0,0,0,2,0,0,0,1],
    [1,2,2,2,2,2,2,2,1],
    [1,0,0,0,2,0,0,0,1],
    [1,0,0,0,2,1,1,0,1],
    [1,0,0,0,2,1,0,0,1],
    [1,1,1,1,1,1,1,1,1],
  ];
}

function renderPreview(canvas, config) {
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width;
  const H    = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0a16';
  ctx.fillRect(0, 0, W, H);

  const map  = buildPreviewMap();
  const ROWS = map.length;
  const COLS = map[0].length;
  const TW   = Math.floor(W / (COLS + 2));
  const TH   = Math.floor(TW * 0.5);
  const WALL_H = Math.floor(TH * 2.8 * (config.tileHeight[2] / 1.5));

  const offsetX = W / 2;
  const offsetY = H * 0.38;
  const rand    = mulberry32(42);

  const cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      cells.push([r, c]);
  cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));

  for (const [r, c] of cells) {
    const type    = map[r][c]; // 0=floor, 1=wall, 2=road
    const tileKey = type === 1 ? 2 : type === 2 ? 3 : 1;

    const above = r > 0      ? map[r-1][c] : -1;
    const below = r < ROWS-1 ? map[r+1][c] : -1;
    const left  = c > 0      ? map[r][c-1] : -1;
    const right = c < COLS-1 ? map[r][c+1] : -1;
    const neighbors = [above, below, left, right];

    const pal          = config.pal[tileKey];
    const paletteColor = pal[Math.floor(rand() * pal.length)];
    let topColor;

    if (type === 0) {
      const nearWall = neighbors.some(n => n === 1);
      const nearPath = neighbors.some(n => n === 2);
      if (nearWall && rand() < config.tProb.FLOOR_NEAR_WALL)
        topColor = config.transitions.FLOOR_NEAR_WALL;
      else if (nearPath && rand() < config.tProb.FLOOR_NEAR_PATH)
        topColor = config.transitions.FLOOR_NEAR_PATH;
      else
        topColor = paletteColor;
    } else if (type === 2) {
      const nearFloor = neighbors.some(n => n === 0);
      if (nearFloor && rand() < config.tProb.PATH_NEAR_FLOOR)
        topColor = config.transitions.PATH_NEAR_FLOOR;
      else
        topColor = paletteColor;
    } else {
      topColor = paletteColor;
    }

    const sx = offsetX + (c - r) * TW * 0.5;
    const sy = offsetY + (c + r) * TH * 0.5;
    const hw = TW * 0.5;
    const hh = TH * 0.5;

    if (type === 1) {
      ctx.beginPath();
      ctx.moveTo(sx,      sy);
      ctx.lineTo(sx - hw, sy + hh);
      ctx.lineTo(sx - hw, sy + hh + WALL_H);
      ctx.lineTo(sx,      sy + WALL_H);
      ctx.closePath();
      ctx.fillStyle = darken(topColor, 40);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx,      sy);
      ctx.lineTo(sx + hw, sy + hh);
      ctx.lineTo(sx + hw, sy + hh + WALL_H);
      ctx.lineTo(sx,      sy + WALL_H);
      ctx.closePath();
      ctx.fillStyle = darken(topColor, 20);
      ctx.fill();

      const wallTopY = sy - WALL_H;
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
      const flatH = type === 0
        ? Math.max(1, Math.round(TH * 0.22 * (config.tileHeight[1] / 0.2)))
        : Math.max(1, Math.round(TH * 0.22 * (config.tileHeight[3] / 0.2)));

      ctx.beginPath();
      ctx.moveTo(sx,      sy);
      ctx.lineTo(sx - hw, sy + hh);
      ctx.lineTo(sx - hw, sy + hh + flatH);
      ctx.lineTo(sx,      sy + flatH);
      ctx.closePath();
      ctx.fillStyle = darken(topColor, 30);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx,      sy);
      ctx.lineTo(sx + hw, sy + hh);
      ctx.lineTo(sx + hw, sy + hh + flatH);
      ctx.lineTo(sx,      sy + flatH);
      ctx.closePath();
      ctx.fillStyle = darken(topColor, 15);
      ctx.fill();

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

  ctx.font      = '10px monospace';
  ctx.fillStyle = '#5a6a8a';
  ctx.fillText('PREVIEW', 10, H - 10);
}

// ── Local UI components ───────────────────────────────────────────────────────

function ColorSwatch({ value, onChange }) {
  const id = useRef(`c_${Math.random().toString(36).slice(2)}`).current;
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <span style={{
        width: 22, height: 22, background: value,
        border: `1px solid ${P.border}`, display: 'block', flexShrink: 0,
      }}/>
      <input
        id={id} type="color" value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: 0, height: 0, opacity: 0, position: 'absolute', pointerEvents: 'none' }}
      />
      <span style={{ fontSize: 10, color: P.muted, letterSpacing: 1 }}>{value.toUpperCase()}</span>
    </label>
  );
}

function PaletteRow({ tileKey, colors, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, color: P.muted, letterSpacing: 3 }}>
        {TILE_LABELS[tileKey].toUpperCase()} PALETTE
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {colors.map((c, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{
              width: 28, height: 28, background: c,
              border: `1px solid ${P.border}`, cursor: 'pointer',
            }} title={`Shade ${i+1}: ${c}`}/>
            <input
              type="color" value={c}
              onChange={e => onChange(i, e.target.value)}
              style={{ width: 28, height: 18, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10, color: P.muted, letterSpacing: 1, width: 130, flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: P.accent, minWidth: 80 }}
      />
      <span style={{ fontSize: 11, color: P.text, width: 36, textAlign: 'right', flexShrink: 0 }}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

// ── Tab component ─────────────────────────────────────────────────────────────

export default function TileMaterialTab({ config, setConfig }) {
  const [exported, setExported] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPreview(canvas, config);
  }, [config]);

  const setPalColor = useCallback((tileKey, idx, hex) => {
    setConfig(prev => {
      const next = deepClone(prev);
      next.pal[tileKey][idx] = hex;
      return next;
    });
  }, [setConfig]);

  const setTransition = useCallback((key, hex) => {
    setConfig(prev => {
      const next = deepClone(prev);
      next.transitions[key] = hex;
      return next;
    });
  }, [setConfig]);

  const setTProb = useCallback((key, val) => {
    setConfig(prev => {
      const next = deepClone(prev);
      next.tProb[key] = val;
      return next;
    });
  }, [setConfig]);

  const setTileHeight = useCallback((tileKey, val) => {
    setConfig(prev => {
      const next = deepClone(prev);
      next.tileHeight[tileKey] = val;
      return next;
    });
  }, [setConfig]);

  const handleExport = useCallback(() => {
    const out = {
      PAL: {
        1: config.pal[1].map(h => parseInt(h.replace('#',''), 16)),
        2: config.pal[2].map(h => parseInt(h.replace('#',''), 16)),
        3: config.pal[3].map(h => parseInt(h.replace('#',''), 16)),
      },
      T: {
        FLOOR_NEAR_WALL: parseInt(config.transitions.FLOOR_NEAR_WALL.replace('#',''), 16),
        FLOOR_NEAR_PATH: parseInt(config.transitions.FLOOR_NEAR_PATH.replace('#',''), 16),
        PATH_NEAR_FLOOR: parseInt(config.transitions.PATH_NEAR_FLOOR.replace('#',''), 16),
      },
      T_PROB:      { ...config.tProb },
      TILE_HEIGHT: { 1: config.tileHeight[1], 2: config.tileHeight[2], 3: config.tileHeight[3] },
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'tile-config.json'; a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, [config]);

  const handleReset = useCallback(() => {
    setConfig(deepClone(DEFAULT_CONFIG));
  }, [setConfig]);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* Controls panel */}
      <div style={{
        width: 320, flexShrink: 0, background: P.panel,
        borderRight: `1px solid ${P.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Section title="TILE PALETTES">
            {[1, 2, 3].map(tk => (
              <PaletteRow
                key={tk} tileKey={tk} colors={config.pal[tk]}
                onChange={(i, hex) => setPalColor(tk, i, hex)}
              />
            ))}
          </Section>

          <Section title="TRANSITION COLORS">
            {Object.entries(T_LABELS).map(([key, label]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 10, color: P.muted, letterSpacing: 1 }}>{label}</span>
                <ColorSwatch value={config.transitions[key]} onChange={hex => setTransition(key, hex)} />
              </div>
            ))}
          </Section>

          <Section title="TRANSITION PROBABILITIES">
            {Object.entries(T_LABELS).map(([key, label]) => (
              <SliderRow
                key={key} label={label} value={config.tProb[key]}
                min={0} max={1} step={0.01}
                onChange={val => setTProb(key, val)}
              />
            ))}
          </Section>

          <Section title="TILE HEIGHTS">
            <SliderRow label="Floor height" value={config.tileHeight[1]} min={0.05} max={1.0} step={0.05} onChange={val => setTileHeight(1, val)} />
            <SliderRow label="Wall height"  value={config.tileHeight[2]} min={0.5}  max={4.0} step={0.1}  onChange={val => setTileHeight(2, val)} />
            <SliderRow label="Road height"  value={config.tileHeight[3]} min={0.05} max={1.0} step={0.05} onChange={val => setTileHeight(3, val)} />
          </Section>
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${P.border}`, display: 'flex', gap: 10 }}>
          <button onClick={handleReset} style={btnStyle(P.muted)}>RESET</button>
          <button onClick={handleExport} style={{ ...btnStyle(exported ? P.good : P.accent), flex: 1 }}>
            {exported ? '✓ EXPORTED' : 'EXPORT JSON'}
          </button>
        </div>
      </div>

      {/* Preview canvas */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: P.bg, position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: 16, left: 20, fontSize: 10, color: P.muted, letterSpacing: 3 }}>
          LIVE PREVIEW
        </div>
        <canvas
          ref={canvasRef} width={700} height={520}
          style={{ border: `1px solid ${P.border}`, imageRendering: 'pixelated', maxWidth: '95%', maxHeight: '85vh' }}
        />
        <div style={{ position: 'absolute', bottom: 16, fontSize: 9, color: P.muted, letterSpacing: 2 }}>
          FLOOR · WALL · ROAD · TRANSITIONS
        </div>
      </div>
    </div>
  );
}
