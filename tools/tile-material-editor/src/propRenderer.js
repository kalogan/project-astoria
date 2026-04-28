// propRenderer.js — procedural canvas rendering for all prop types.
//
// Props are drawn in isometric world-space.
// Caller converts (prop.x + prop.offsetX, prop.y + prop.offsetY) to screen,
// then passes (screenX, screenY) to drawProp.
//
// TW/TH: tile width/height constants (64/32).
// Props are drawn relative to the tile's top-vertex screen position.

import { PROP_DEFS } from './propDefs';

// ── Internal drawing primitives ───────────────────────────────────────────────

function _tree(ctx, size, color) {
  // Trunk
  ctx.fillStyle = '#5a3b22';
  ctx.fillRect(-2, -size * 0.25, 4, size * 0.6);
  // Shadow ellipse under canopy
  ctx.save();
  ctx.globalAlpha *= 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.08, size * 0.65, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Canopy
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -size * 0.55, size * 0.70, 0, Math.PI * 2);
  ctx.fill();
  // Highlight
  ctx.save();
  ctx.globalAlpha *= 0.22;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-size * 0.18, -size * 0.72, size * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _bush(ctx, size, color) {
  ctx.save();
  ctx.globalAlpha *= 0.15;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.35, size * 0.75, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    const ox = (i - 1) * size * 0.48;
    const oy = i === 1 ? -size * 0.15 : 0;
    const r  = size * (i === 1 ? 0.42 : 0.34);
    ctx.fillStyle = i % 2 === 0 ? color : _lighten(color, 12);
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function _rock(ctx, size, color) {
  ctx.save();
  ctx.globalAlpha *= 0.2;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.28, size * 0.68, size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.40);
  ctx.lineTo(size * 0.42, -size * 0.12);
  ctx.lineTo(size * 0.38, size * 0.28);
  ctx.lineTo(-size * 0.38, size * 0.28);
  ctx.lineTo(-size * 0.44, -size * 0.10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = _lighten(color, 22);
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.40);
  ctx.lineTo(size * 0.42, -size * 0.12);
  ctx.lineTo(0, -size * 0.06);
  ctx.closePath();
  ctx.fill();
}

function _barrel(ctx, size, color) {
  const w = size * 0.55, h = size * 0.82;
  ctx.save();
  ctx.globalAlpha *= 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.5 + 2, w * 0.65, h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-w * 0.5, -h * 0.5, w, h, w * 0.35);
  ctx.fill();
  // Stave lines
  ctx.strokeStyle = _darken(color, 20);
  ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, i * h * 0.28);
    ctx.lineTo(w * 0.5, i * h * 0.28);
    ctx.stroke();
  }
  // Highlight
  ctx.save();
  ctx.globalAlpha *= 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-w * 0.5, -h * 0.5, w * 0.32, h);
  ctx.restore();
}

function _crate(ctx, size, color) {
  const s = size * 0.72;
  ctx.save();
  ctx.globalAlpha *= 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.5 + 2, s * 0.68, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = color;
  ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
  ctx.strokeStyle = _darken(color, 25);
  ctx.lineWidth = 1;
  ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, 0); ctx.lineTo(s * 0.5, 0);
  ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, s * 0.5);
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha *= 0.14;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-s * 0.5, -s * 0.5, s * 0.38, s);
  ctx.restore();
}

function _torch(ctx, _size, _color, wallDir) {
  const rotMap = { north: Math.PI, south: 0, east: -Math.PI / 2, west: Math.PI / 2 };
  const rot = rotMap[wallDir] ?? 0;
  ctx.save();
  ctx.rotate(rot);
  // Handle
  ctx.strokeStyle = '#5a3b22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(0, -6);
  ctx.stroke();
  // Flame glow
  ctx.save();
  ctx.globalAlpha *= 0.22;
  ctx.fillStyle = '#ffee88';
  ctx.beginPath();
  ctx.arc(0, -9, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Flame
  ctx.fillStyle = '#ff9922';
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.bezierCurveTo(4, -10, 4, -6, 0, -6);
  ctx.bezierCurveTo(-4, -6, -4, -10, 0, -14);
  ctx.fill();
  ctx.fillStyle = '#ffee66';
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.bezierCurveTo(2, -10, 2, -8, 0, -8);
  ctx.bezierCurveTo(-2, -8, -2, -10, 0, -13);
  ctx.fill();
  ctx.restore();
}

function _door(ctx, size, color, wallDir) {
  const rotMap = { north: 0, south: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };
  ctx.save();
  ctx.rotate(rotMap[wallDir] ?? 0);
  const w = size * 0.55, h = size;
  ctx.fillStyle = _darken(color, 15);
  ctx.fillRect(-w * 0.5 - 2, -h * 0.5 - 2, w + 4, h + 4);
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
  // Door frame
  ctx.strokeStyle = _darken(color, 30);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
  // Panel detail
  ctx.strokeStyle = _lighten(color, 10);
  ctx.lineWidth = 1;
  ctx.strokeRect(-w * 0.5 + 3, -h * 0.5 + 3, w - 6, h * 0.4 - 3);
  ctx.strokeRect(-w * 0.5 + 3, -h * 0.5 + h * 0.4 + 1, w - 6, h * 0.6 - 7);
  // Knob
  ctx.fillStyle = '#d4a040';
  ctx.beginPath();
  ctx.arc(w * 0.28, h * 0.05, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _window(ctx, size, _color, wallDir) {
  const rotMap = { north: 0, south: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };
  ctx.save();
  ctx.rotate(rotMap[wallDir] ?? 0);
  const s = size * 0.62;
  ctx.fillStyle = '#333355';
  ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
  ctx.fillStyle = '#a8d8f0';
  ctx.fillRect(-s * 0.5 + 2, -s * 0.5 + 2, s - 4, s - 4);
  ctx.strokeStyle = '#c0c0c8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.5 + 2); ctx.lineTo(0, s * 0.5 - 2);
  ctx.moveTo(-s * 0.5 + 2, 0); ctx.lineTo(s * 0.5 - 2, 0);
  ctx.strokeStyle = '#c0c0c8';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function _fence(ctx, size, color, edgeDir) {
  ctx.save();
  if (edgeDir === 'vertical') ctx.rotate(Math.PI / 2);
  const w = size * 1.0, postH = size * 0.55;
  // Rail
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5, -postH * 0.55, w, postH * 0.14);
  ctx.fillRect(-w * 0.5, -postH * 0.25, w, postH * 0.14);
  // Posts
  for (const ox of [-w * 0.42, 0, w * 0.42]) {
    ctx.fillStyle = _darken(color, 12);
    ctx.fillRect(ox - 2, -postH * 0.65, 4, postH * 0.88);
  }
  ctx.restore();
}

function _log(ctx, size, color) {
  ctx.save();
  ctx.rotate(Math.PI / 6);
  const w = size * 0.9, h = size * 0.36;
  ctx.save();
  ctx.globalAlpha *= 0.15;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.5 + 1, w * 0.52, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = _darken(color, 8);
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5 + 2, -h * 0.5 + 2, w - 4, h - 4);
  // End rings
  ctx.fillStyle = _lighten(color, 18);
  ctx.beginPath();
  ctx.ellipse(-w * 0.5 + 2, 0, 4, h * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _mushroom(ctx, size, color) {
  // Stem
  ctx.fillStyle = '#e8e0c8';
  ctx.fillRect(-size * 0.12, 0, size * 0.24, size * 0.4);
  // Cap
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.4, Math.PI, 0);
  ctx.fill();
  // Spots
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [ox, oy] of [[-size * 0.15, -size * 0.12], [size * 0.1, -size * 0.18]]) {
    ctx.beginPath();
    ctx.arc(ox, oy, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
}

function _chest(ctx, size, color) {
  const w = size * 0.68, h = size * 0.5;
  ctx.save();
  ctx.globalAlpha *= 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.5 + 2, w * 0.6, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Base
  ctx.fillStyle = _darken(color, 20);
  ctx.fillRect(-w * 0.5, 0, w, h * 0.55);
  // Lid
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5, -h * 0.45, w, h * 0.55);
  ctx.beginPath();
  ctx.arc(0, -h * 0.45, w * 0.5, Math.PI, 0);
  ctx.fill();
  // Clasp
  ctx.fillStyle = '#d4a040';
  ctx.fillRect(-3, -h * 0.08, 6, h * 0.18);
  // Border
  ctx.strokeStyle = _darken(color, 35);
  ctx.lineWidth = 1;
  ctx.strokeRect(-w * 0.5, -h * 0.45, w, h);
}

function _pillar(ctx, size, color) {
  const w = size * 0.4, h = size * 1.1;
  ctx.save();
  ctx.globalAlpha *= 0.2;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.5 + 2, w * 0.7, w * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Shaft
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
  // Capital
  ctx.fillStyle = _lighten(color, 12);
  ctx.fillRect(-w * 0.65, -h * 0.5, w * 1.3, h * 0.12);
  // Base
  ctx.fillRect(-w * 0.65, h * 0.38, w * 1.3, h * 0.12);
  // Highlight
  ctx.save();
  ctx.globalAlpha *= 0.16;
  ctx.fillStyle = '#fff';
  ctx.fillRect(-w * 0.5, -h * 0.5, w * 0.3, h);
  ctx.restore();
}

function _altar(ctx, size, color) {
  const w = size * 1.1, h = size * 0.75;
  ctx.save();
  ctx.globalAlpha *= 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.5 + 2, w * 0.7, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = _darken(color, 18);
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5 + 3, -h * 0.5, w - 6, h - 4);
  // Rune symbol
  ctx.strokeStyle = _lighten(color, 30);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.3); ctx.lineTo(0, h * 0.15);
  ctx.moveTo(-h * 0.2, -h * 0.1); ctx.lineTo(h * 0.2, -h * 0.1);
  ctx.stroke();
}

function _bones(ctx, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  // Two crossed bones
  for (const [a1, a2] of [[Math.PI * 0.25, Math.PI * 1.25], [Math.PI * 0.75, Math.PI * 1.75]]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a1) * size * 0.35, Math.sin(a1) * size * 0.35);
    ctx.lineTo(Math.cos(a2) * size * 0.35, Math.sin(a2) * size * 0.35);
    ctx.stroke();
  }
}

function _skull(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -size * 0.1, size * 0.38, 0, Math.PI * 2);
  ctx.fill();
  // Jaw
  ctx.fillStyle = _darken(color, 12);
  ctx.fillRect(-size * 0.22, size * 0.15, size * 0.44, size * 0.22);
  // Eye sockets
  ctx.fillStyle = '#222';
  for (const ox of [-size * 0.13, size * 0.13]) {
    ctx.beginPath();
    ctx.arc(ox, -size * 0.12, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function _cart(ctx, size, color) {
  const w = size * 1.1, h = size * 0.52, wh = size * 0.22;
  ctx.save();
  ctx.globalAlpha *= 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.5 + 3, w * 0.62, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Body
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
  ctx.strokeStyle = _darken(color, 28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
  // Wheels
  for (const ox of [-w * 0.36, w * 0.36]) {
    ctx.fillStyle = '#2a1a08';
    ctx.beginPath();
    ctx.arc(ox, h * 0.35, wh, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b4a28';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function _table(ctx, size, color) {
  const w = size * 1.0, h = size * 0.38, legH = size * 0.42;
  ctx.save();
  ctx.globalAlpha *= 0.15;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.5 + legH + 2, w * 0.55, legH * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Legs
  ctx.fillStyle = _darken(color, 22);
  for (const ox of [-w * 0.38, w * 0.38]) {
    ctx.fillRect(ox - 2, h * 0.5, 4, legH);
  }
  // Top
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
  ctx.strokeStyle = _darken(color, 28);
  ctx.lineWidth = 1;
  ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
}

function _sign(ctx, size, color) {
  const w = size * 0.7, h = size * 0.45;
  // Post
  ctx.fillStyle = _darken(color, 22);
  ctx.fillRect(-2, 0, 4, size * 0.4);
  // Board
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.5, -h * 0.5 - size * 0.1, w, h);
  ctx.strokeStyle = _darken(color, 30);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w * 0.5, -h * 0.5 - size * 0.1, w, h);
  // Text lines
  ctx.fillStyle = '#222';
  for (const oy of [-size * 0.18, -size * 0.06]) {
    ctx.fillRect(-w * 0.32, oy, w * 0.64, 2);
  }
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function _hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function _darken(hex, amt) {
  const [r, g, b] = _hexToRgb(hex);
  return `rgb(${Math.max(0, r - amt)},${Math.max(0, g - amt)},${Math.max(0, b - amt)})`;
}

function _lighten(hex, amt) {
  const [r, g, b] = _hexToRgb(hex);
  return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
}

// ── Main draw function ────────────────────────────────────────────────────────
//
// sx, sy: screen position of the TILE TOP VERTEX for the prop's (x, y) cell.
//         Caller applies zoom/pan via setTransform before calling this.
// TW, TH: tile constants
// prop:   { type, offsetX, offsetY, rotation, scale, ... }
// wallDir: from detectWallDirection (for wall-anchored props)
// edgeDir: 'horizontal' | 'vertical' (for edge props)
// alpha:   override opacity (for ghost preview)

export function drawProp(ctx, sx, sy, TW, TH, prop, wallDir, edgeDir, alpha = 1) {
  const def  = PROP_DEFS[prop.type];
  if (!def) return;

  const { color, size = 1.0 } = def;
  const scale  = (prop.scale ?? 1.0) * size;
  const rot    = prop.rotation ?? 0;

  // Prop is drawn at the tile's center (diamond center = top + TH/2)
  const drawX = sx + (prop.offsetX ?? 0) * TW;
  const drawY = sy + TH * 0.5 + (prop.offsetY ?? 0) * TH;

  // Ground shadow ellipse (all props)
  ctx.save();
  ctx.globalAlpha = alpha * 0.20;
  ctx.fillStyle   = '#000';
  ctx.beginPath();
  ctx.ellipse(drawX, drawY, TW * 0.28 * scale, TH * 0.18 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(drawX, drawY);
  ctx.rotate(rot);
  ctx.scale(scale * (TW / 64), scale * (TH / 32));  // normalize to 64/32 tile

  switch (prop.type) {
    case 'tree_small': _tree(ctx, 14, color); break;
    case 'tree_large': _tree(ctx, 20, color); break;
    case 'bush':       _bush(ctx, 12, color); break;
    case 'rock_small': _rock(ctx, 10, color); break;
    case 'log':        _log(ctx, 18, color);  break;
    case 'mushroom':   _mushroom(ctx, 9, color); break;

    case 'barrel': _barrel(ctx, 14, color); break;
    case 'crate':  _crate(ctx, 13, color);  break;
    case 'torch':  _torch(ctx, 10, color, wallDir); break;
    case 'cart':   _cart(ctx, 16, color);   break;
    case 'table':  _table(ctx, 14, color);  break;
    case 'sign':   _sign(ctx, 12, color);   break;

    case 'chest':  _chest(ctx, 13, color);  break;
    case 'pillar': _pillar(ctx, 14, color); break;
    case 'altar':  _altar(ctx, 14, color);  break;
    case 'bones':  _bones(ctx, 10, color);  break;
    case 'skull':  _skull(ctx, 9, color);   break;

    case 'fence_wood':  _fence(ctx, 18, color, edgeDir ?? 'horizontal'); break;
    case 'fence_stone': _fence(ctx, 18, color, edgeDir ?? 'horizontal'); break;
    case 'door_wood':   _door(ctx, 14, color, wallDir ?? 'south');        break;
    case 'window_small':_window(ctx, 12, color, wallDir ?? 'south');      break;
    default: {
      // Fallback: colored circle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

// ── Depth sort key ────────────────────────────────────────────────────────────
// Props render in painter's order: lower (x+y) values first.
// Height and multi-tile footprint extend the sort to back-to-front.

export function propSortKey(prop) {
  const def = PROP_DEFS[prop.type] ?? {};
  return (prop.x + (def.width ?? 1) - 1) + (prop.y + (def.height ?? 1) - 1)
       + (prop.offsetY ?? 0);
}

// ── Selection hit-test ────────────────────────────────────────────────────────
// Returns the prop closest to (mx, my) screen point within HIT_RADIUS,
// or null. sx/sy is the screen top-vertex for tile (prop.x, prop.y).

export function propHitTest(props, screenPositions, mx, my, zoom) {
  const HIT_R = 14 * zoom;
  let best = null, bestDist = HIT_R;
  for (let i = 0; i < props.length; i++) {
    const [px, py] = screenPositions[i];
    const d = Math.hypot(mx - px, my - py);
    if (d < bestDist) { bestDist = d; best = props[i]; }
  }
  return best;
}
