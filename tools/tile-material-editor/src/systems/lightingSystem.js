// lightingSystem.js — Canvas2D radial lighting with flicker and FOV masking.
//
// Pipeline (all screen-space, called AFTER ctx.restore from world transform):
//   1. Build offscreen canvas; fill with ambient darkness.
//   2. Punch out light zones with destination-out radial gradients.
//   3. Optionally re-darken non-visible tiles (FOV integration).
//   4. Composite darkness canvas onto world canvas.
//   5. Draw warm-colour glow additively (globalCompositeOperation = 'lighter').
//
// Usage:
//   const lights = buildFrameLights(zone);          // once per frame
//   tickLights(lights, performance.now() / 1000);   // advance flicker
//   drawLightingPass(ctx, W, H, lights, tiles, camera, gridToScreen,
//                    ISO_ORIGIN, TW, TH, heights, HEIGHT_SCALE,
//                    darkAlpha, fovSet, exploredSet, showLightRadius);

// ── Presets ────────────────────────────────────────────────────────────────────

export const LIGHT_PRESETS = {
  torch:   { radius: 150, color: { r: 255, g: 178, b: 75  }, intensity: 0.90, flicker: true,  type: 'torch'   },
  fire:    { radius: 210, color: { r: 255, g: 120, b: 38  }, intensity: 0.95, flicker: true,  type: 'fire'    },
  magic:   { radius: 115, color: { r: 145, g: 100, b: 255 }, intensity: 0.80, flicker: false, type: 'magic'   },
  crystal: { radius: 95,  color: { r: 80,  g: 205, b: 255 }, intensity: 0.68, flicker: false, type: 'crystal' },
  candle:  { radius: 80,  color: { r: 255, g: 200, b: 110 }, intensity: 0.72, flicker: true,  type: 'candle'  },
  ambient: { radius: 300, color: { r: 200, g: 210, b: 230 }, intensity: 0.45, flicker: false, type: 'ambient' },
};

// ── Light factory ──────────────────────────────────────────────────────────────

function _jitter(v, amt) { return Math.max(0, Math.min(255, v + Math.round((Math.random() - 0.5) * amt * 2))); }

export function createLight(id, x, y, preset = 'torch', overrides = {}) {
  const base = LIGHT_PRESETS[preset] ?? LIGHT_PRESETS.torch;
  return {
    id,
    x, y,
    radius:    base.radius    + Math.round((Math.random() - 0.5) * 22),
    color:     { r: _jitter(base.color.r, 18), g: _jitter(base.color.g, 10), b: _jitter(base.color.b, 14) },
    intensity: Math.max(0.4, Math.min(1, base.intensity + (Math.random() - 0.5) * 0.10)),
    flicker:   base.flicker,
    type:      base.type,
    _phase:    Math.random() * Math.PI * 2,
    _flickerI: 0,
    _flickerR: 0,
    ...overrides,
  };
}

export function createTorchLight(x, y, id) {
  return createLight(id ?? `torch_${x}_${y}`, x, y, 'torch');
}

// ── Flicker update (call each frame) ─────────────────────────────────────────

export function tickLights(lights, timeSec) {
  for (const light of lights) {
    if (!light.flicker) { light._flickerI = 0; light._flickerR = 0; continue; }
    const t = timeSec + light._phase;
    // Two sine waves at different rates for naturalistic flicker
    light._flickerI = Math.sin(t * 3.8) * 0.055 + Math.sin(t * 7.3 + 1.2) * 0.025;
    light._flickerR = Math.sin(t * 2.9) * 4.5   + Math.sin(t * 5.1 + 0.7) * 2.0;
  }
}

// ── Build light list for this frame ───────────────────────────────────────────
// Combines zone.lights (manually placed) with auto-generated prop lights.

const PROP_LIGHT_PRESETS = {
  torch:      'torch',
  torch_wall: 'torch',
  candle:     'candle',
  fire:       'fire',
};

export function buildFrameLights(zone) {
  const lights = [];

  // Manual lights in zone.lights
  for (const l of zone?.lights ?? []) {
    lights.push({ _flickerI: 0, _flickerR: 0, ...l });
  }

  // Auto-generate from torch/candle props
  for (const prop of zone?.props ?? []) {
    const preset = PROP_LIGHT_PRESETS[prop.type];
    if (!preset) continue;
    const existId = `_prop_${prop.id}`;
    if (lights.some(l => l.id === existId)) continue;
    const l = createLight(existId, prop.x, prop.y, preset);
    l._propId = prop.id;
    lights.push(l);
  }

  return lights;
}

// ── Offscreen canvas (module-level singleton) ─────────────────────────────────

let _lc = null, _lcW = 0, _lcH = 0;

function _getLightCanvas(W, H) {
  if (!_lc || _lcW !== W || _lcH !== H) {
    _lc = document.createElement('canvas');
    _lc.width  = W;
    _lc.height = H;
    _lcW = W; _lcH = H;
  }
  return _lc;
}

// ── Screen-position helper (called inside drawLightingPass) ───────────────────

function _lightScreen(light, camera, gridToScreen, ISO_ORIGIN, TW, TH, heights, HEIGHT_SCALE) {
  const h   = heights?.[light.y]?.[light.x] ?? 0;
  const { x: wx, y: wyBase } = gridToScreen(light.y, light.x, ISO_ORIGIN, TW, TH);
  const wy  = wyBase - h * HEIGHT_SCALE;
  const { panX, panY, zoom } = camera;
  return {
    cx:  wx  * zoom + panX,
    cy:  (wy + TH * 0.5) * zoom + panY,
    rPx: (light.radius + (light._flickerR ?? 0)) * zoom,
    eff: Math.max(0.05, Math.min(1, (light.intensity ?? 0.9) + (light._flickerI ?? 0))),
  };
}

// ── Main draw function ─────────────────────────────────────────────────────────
//
// fovSet:      Set<"row,col"> from computeFOV — if provided, lights only
//              illuminate visible tiles (non-visible stays dark).
// exploredSet: Set<"row,col"> — explored but not currently visible (dim).
// darkAlpha:   overall ambient darkness strength (0 = bright, 1 = pitch black).
// showLightRadius: debug — draw light radius circles.

export function drawLightingPass(
  ctx, W, H,
  lights, tiles, camera,
  gridToScreen, ISO_ORIGIN, TW, TH,
  heights, HEIGHT_SCALE,
  darkAlpha       = 0.78,
  fovSet          = null,
  exploredSet     = null,
  showLightRadius = false,
) {
  if (darkAlpha <= 0.01 && lights.length === 0) return;

  const { panX, panY, zoom } = camera;

  // ── Pre-compute screen positions; viewport-cull ───────────────────────────
  const sp = lights.map(l => _lightScreen(l, camera, gridToScreen, ISO_ORIGIN, TW, TH, heights, HEIGHT_SCALE));
  const vis = sp.map(({ cx, cy, rPx }) =>
    cx + rPx > 0 && cx - rPx < W && cy + rPx > 0 && cy - rPx < H
  );

  // ── Build darkness canvas ─────────────────────────────────────────────────
  const lc   = _getLightCanvas(W, H);
  const lctx = lc.getContext('2d');

  lctx.clearRect(0, 0, W, H);
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = `rgba(0,0,0,${darkAlpha.toFixed(3)})`;
  lctx.fillRect(0, 0, W, H);

  // Punch holes for each light (destination-out = erase darkness where light shines)
  lctx.globalCompositeOperation = 'destination-out';
  const MAX_LIGHTS = 24;
  let drawn = 0;
  for (let i = 0; i < lights.length && drawn < MAX_LIGHTS; i++) {
    if (!vis[i]) continue;
    drawn++;
    const { cx, cy, rPx, eff } = sp[i];
    const grad = lctx.createRadialGradient(cx, cy, 0, cx, cy, rPx);
    // Non-linear (quadratic-ish) falloff — bright centre, fast outer roll-off
    grad.addColorStop(0,    `rgba(0,0,0,${eff.toFixed(3)})`);
    grad.addColorStop(0.18, `rgba(0,0,0,${(eff * 0.92).toFixed(3)})`);
    grad.addColorStop(0.48, `rgba(0,0,0,${(eff * 0.50).toFixed(3)})`);
    grad.addColorStop(0.78, `rgba(0,0,0,${(eff * 0.14).toFixed(3)})`);
    grad.addColorStop(1,    'rgba(0,0,0,0)');
    lctx.fillStyle = grad;
    lctx.fillRect(cx - rPx, cy - rPx, rPx * 2, rPx * 2);
  }

  // ── FOV integration: re-darken non-visible tiles ──────────────────────────
  // If fovSet is provided, unexplored areas are pitch-black regardless of lights.
  // Explored (but not currently visible) areas get a heavy darkness overlay.
  if (fovSet && tiles?.length) {
    lctx.globalCompositeOperation = 'source-over';
    const rows = tiles.length, cols = tiles[0]?.length ?? 0;
    const hw = TW * 0.5 * zoom, hh = TH * 0.5 * zoom, th = TH * zoom;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (tiles[r][c] === 0) continue;
        const key = `${r},${c}`;
        const isVisible  = fovSet.has(key);
        const isExplored = exploredSet ? exploredSet.has(key) : false;

        if (isVisible) continue; // fully lit — leave hole as-is

        const h   = heights?.[r]?.[c] ?? 0;
        const { x: wx, y: wyBase } = gridToScreen(r, c, ISO_ORIGIN, TW, TH);
        const wy  = wyBase - h * HEIGHT_SCALE;
        const sx  = wx * zoom + panX;
        const sy  = wy * zoom + panY;

        lctx.beginPath();
        lctx.moveTo(sx,       sy);
        lctx.lineTo(sx - hw,  sy + hh);
        lctx.lineTo(sx,       sy + th);
        lctx.lineTo(sx + hw,  sy + hh);
        lctx.closePath();
        // Explored → heavy but not total darkness; unseen → fill fully black
        lctx.fillStyle = isExplored ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.96)';
        lctx.fill();
      }
    }
  }

  // ── Composite darkness layer onto world ───────────────────────────────────
  lctx.globalCompositeOperation = 'source-over'; // reset
  ctx.drawImage(lc, 0, 0);

  // ── Warm colour glow (additive, 'lighter' blend) ──────────────────────────
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawn = 0;
  for (let i = 0; i < lights.length && drawn < MAX_LIGHTS; i++) {
    if (!vis[i]) continue;
    drawn++;
    const { cx, cy, rPx, eff } = sp[i];
    const { r, g, b } = lights[i].color;
    const innerR = rPx * 0.22;
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, rPx * 0.80);
    grad.addColorStop(0,   `rgba(${r},${g},${b},${(eff * 0.38).toFixed(3)})`);
    grad.addColorStop(0.35,`rgba(${r},${g},${b},${(eff * 0.18).toFixed(3)})`);
    grad.addColorStop(0.72,`rgba(${r},${g},${b},${(eff * 0.06).toFixed(3)})`);
    grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rPx, cy - rPx, rPx * 2, rPx * 2);
  }
  ctx.restore();

  // ── Debug: light radius circles ───────────────────────────────────────────
  if (showLightRadius) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < lights.length; i++) {
      if (!vis[i]) continue;
      const { cx, cy, rPx } = sp[i];
      const { r, g, b } = lights[i].color;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.fillText(`${lights[i].type} (${lights[i].x},${lights[i].y})`, cx, cy - rPx - 4);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}
