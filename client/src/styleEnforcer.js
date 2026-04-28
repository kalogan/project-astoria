// Style enforcer — final visual pass that validates and auto-corrects scene meshes.
//
// Runs after visualPassSystem to ensure all props/borders conform to theme rules.
// Validates: scale bounds, wall height, material color proximity to palette.
// Corrects: clamps out-of-range scales, snaps colors to nearest theme color.

import * as THREE from 'three';

// ── Style configs ─────────────────────────────────────────────────────────────
//
// Each config mirrors a KitbashSystem theme and adds constraint ranges.

export const STYLE_CONFIGS = {
  forest: {
    propScale:     { min: 0.4, max: 2.2 },
    wallHeight:    { min: 1.8, max: 3.0 },
    floorVariance: 0.06,
    palette:       [0x4a3728, 0x5a7a3a, 0x4e6e2e, 0x3d5a24, 0x2d4a1e, 0x8b6914],
    playerContrast: 0.35,  // minimum luminance contrast against floor
  },
  dungeon: {
    propScale:     { min: 0.4, max: 2.0 },
    wallHeight:    { min: 2.2, max: 3.5 },
    floorVariance: 0.04,
    palette:       [0x2a2a38, 0x1a1a24, 0x222232, 0x181820, 0x3a3a48, 0x8b6914, 0x5a1a1a],
    playerContrast: 0.45,
  },
  hub: {
    propScale:     { min: 0.4, max: 1.8 },
    wallHeight:    { min: 1.8, max: 2.6 },
    floorVariance: 0.04,
    palette:       [0x8b7355, 0xc8a96e, 0xb89660, 0xd4b080, 0x5a7a5a],
    playerContrast: 0.30,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _hexToRGB(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function _colorDist(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function _nearestPalette(hexColor, palette) {
  const c = _hexToRGB(hexColor);
  let best = palette[0], bestDist = Infinity;
  for (const p of palette) {
    const d = _colorDist(c, _hexToRGB(p));
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return { color: best, dist: bestDist };
}

// ── StyleEnforcer ─────────────────────────────────────────────────────────────

export class StyleEnforcer {
  constructor() {
    this._theme      = 'dungeon';
    this._tolerance  = 80;   // max color distance before correction triggers
    this.enabled     = true;
  }

  setTheme(name) {
    if (STYLE_CONFIGS[name]) this._theme = name;
  }

  getTheme() { return this._theme; }

  // ── Validate ──────────────────────────────────────────────────────────────

  // Returns { ok, violations } without modifying anything.
  validate(scene) {
    const cfg        = STYLE_CONFIGS[this._theme];
    const violations = [];

    scene.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (!obj.userData.isProp && !obj.userData.isBorder) return;

      const s = obj.scale;
      if (s.x < cfg.propScale.min || s.x > cfg.propScale.max ||
          s.y < cfg.propScale.min || s.y > cfg.propScale.max ||
          s.z < cfg.propScale.min || s.z > cfg.propScale.max) {
        violations.push({ type: 'scale', obj, scale: s.clone() });
      }

      const mat = obj.material;
      if (mat?.color) {
        const hex  = mat.color.getHex();
        const { dist } = _nearestPalette(hex, cfg.palette);
        if (dist > this._tolerance) {
          violations.push({ type: 'color', obj, hex, dist: Math.round(dist) });
        }
      }
    });

    return { ok: violations.length === 0, violations };
  }

  // ── Correct ───────────────────────────────────────────────────────────────

  // Mutates out-of-spec meshes to conform to theme constraints.
  // Returns the number of corrections made.
  correct(scene) {
    if (!this.enabled) return 0;

    const cfg  = STYLE_CONFIGS[this._theme];
    let   n    = 0;

    scene.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (!obj.userData.isProp && !obj.userData.isBorder) return;

      // Clamp scale
      const { min, max } = cfg.propScale;
      const s = obj.scale;
      if (s.x < min || s.x > max || s.y < min || s.y > max || s.z < min || s.z > max) {
        obj.scale.set(
          Math.max(min, Math.min(max, s.x)),
          Math.max(min, Math.min(max, s.y)),
          Math.max(min, Math.min(max, s.z)),
        );
        n++;
      }

      // Snap color to nearest palette entry if too far off
      const mat = obj.material;
      if (mat?.color) {
        const hex  = mat.color.getHex();
        const { color, dist } = _nearestPalette(hex, cfg.palette);
        if (dist > this._tolerance) {
          mat.color.setHex(color);
          n++;
        }
      }
    });

    if (n > 0) console.log(`[StyleEnforcer] corrected ${n} violations  theme=${this._theme}`);
    return n;
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect(scene) {
    const { ok, violations } = this.validate(scene);
    console.group(`[StyleEnforcer] theme=${this._theme}  ok=${ok}`);
    for (const v of violations) {
      if (v.type === 'scale')  console.log(`scale out-of-range:`, v.scale);
      if (v.type === 'color')  console.log(`color dist=${v.dist}  hex=#${v.hex.toString(16).padStart(6,'0')}`);
    }
    console.groupEnd();
  }

  toggle() {
    this.enabled = !this.enabled;
    console.log(`[StyleEnforcer] enabled=${this.enabled}`);
  }
}
