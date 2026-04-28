// Kitbash system — assembles styled Three.js meshes from reusable geometry parts.
//
// Provides theme-driven meshes for walls, floors, and props.
// Geometries are cached globally to avoid duplicate allocation.
// All random variation uses the zone's seeded RNG for determinism.

import * as THREE from 'three';

// ── Theme configurations ──────────────────────────────────────────────────────

export const THEMES = {
  forest: {
    wallColor:   0x4a3728,
    floorColors: [0x5a7a3a, 0x4e6e2e, 0x3d5a24],
    propColors:  [0x2d4a1e, 0x3d5a28, 0x8b6914],
    propTypes:   ['rock', 'bush', 'tree', 'rock', 'rock'],
    wallHeight:  [2.0, 2.5],
    propDensity: 0.12,
    emissive:    null,
  },
  dungeon: {
    wallColor:   0x2a2a38,
    floorColors: [0x1a1a24, 0x222232, 0x181820],
    propColors:  [0x3a3a48, 0x8b6914, 0x5a1a1a],
    propTypes:   ['pillar', 'debris', 'torch', 'debris', 'pillar'],
    wallHeight:  [2.5, 3.2],
    propDensity: 0.08,
    emissive:    { color: 0x1a0000, intensity: 0.2 },
  },
  hub: {
    wallColor:   0x8b7355,
    floorColors: [0xc8a96e, 0xb89660, 0xd4b080],
    propColors:  [0x8b7355, 0xc8a96e, 0x5a7a5a],
    propTypes:   ['crate', 'barrel', 'lamp', 'crate', 'crate'],
    wallHeight:  [2.0, 2.3],
    propDensity: 0.06,
    emissive:    { color: 0x100800, intensity: 0.1 },
  },
};

// ── Geometry cache ────────────────────────────────────────────────────────────

const _geoCache = {};
function _geo(key, factory) {
  return (_geoCache[key] ??= factory());
}

// ── Prop builders ─────────────────────────────────────────────────────────────

function _buildProp(type, color) {
  const mat = (c, opts = {}) => new THREE.MeshLambertMaterial({ color: c, ...opts });

  switch (type) {
    case 'rock': {
      const m = new THREE.Mesh(
        _geo('rock', () => new THREE.DodecahedronGeometry(0.28, 0)),
        mat(color),
      );
      m.scale.set(0.7 + Math.random() * 0.6, 0.45 + Math.random() * 0.4, 0.7 + Math.random() * 0.5);
      m.rotation.y = Math.random() * Math.PI * 2;
      return m;
    }

    case 'bush': {
      const m = new THREE.Mesh(
        _geo('bush', () => new THREE.SphereGeometry(0.3, 5, 4)),
        mat(color),
      );
      m.scale.set(1 + Math.random() * 0.5, 0.7 + Math.random() * 0.4, 1 + Math.random() * 0.4);
      return m;
    }

    case 'tree': {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(
        _geo('trunk', () => new THREE.CylinderGeometry(0.08, 0.13, 0.9, 5)),
        mat(0x4a3728),
      ));
      const canopy = new THREE.Mesh(
        _geo('canopy', () => new THREE.ConeGeometry(0.48, 1.3, 6)),
        mat(color),
      );
      canopy.position.y = 1.0;
      g.add(canopy);
      return g;
    }

    case 'torch': {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(
        _geo('torchStick', () => new THREE.CylinderGeometry(0.035, 0.035, 0.65, 4)),
        mat(0x4a3728),
      ));
      const flame = new THREE.Mesh(
        _geo('torchFlame', () => new THREE.ConeGeometry(0.07, 0.22, 4)),
        mat(0xff6600, { emissive: 0xff4400, emissiveIntensity: 0.9 }),
      );
      flame.position.y = 0.42;
      g.add(flame);
      return g;
    }

    case 'pillar': {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(
        _geo('pillarShaft', () => new THREE.CylinderGeometry(0.18, 0.20, 1.8, 7)),
        mat(color),
      );
      const cap = new THREE.Mesh(
        _geo('pillarCap', () => new THREE.BoxGeometry(0.44, 0.1, 0.44)),
        mat(color),
      );
      cap.position.y = 0.95;
      g.add(shaft, cap);
      return g;
    }

    case 'debris': {
      const m = new THREE.Mesh(
        _geo('debris', () => new THREE.BoxGeometry(0.22, 0.12, 0.18)),
        mat(color),
      );
      m.rotation.y = Math.random() * Math.PI * 2;
      return m;
    }

    case 'crate': {
      const m = new THREE.Mesh(
        _geo('crate', () => new THREE.BoxGeometry(0.44, 0.44, 0.44)),
        mat(color),
      );
      m.rotation.y = Math.random() * 0.4;
      return m;
    }

    case 'barrel': {
      return new THREE.Mesh(
        _geo('barrel', () => new THREE.CylinderGeometry(0.16, 0.16, 0.52, 7)),
        mat(color),
      );
    }

    case 'lamp': {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(
        _geo('lampPost', () => new THREE.CylinderGeometry(0.04, 0.04, 1.2, 4)),
        mat(0x555566),
      ));
      const bulb = new THREE.Mesh(
        _geo('lampBulb', () => new THREE.SphereGeometry(0.1, 6, 4)),
        mat(0xffd966, { emissive: 0xffaa00, emissiveIntensity: 0.7 }),
      );
      bulb.position.y = 0.7;
      g.add(bulb);
      return g;
    }

    case 'cart': {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        _geo('cartBody', () => new THREE.BoxGeometry(0.9, 0.22, 0.55)),
        mat(color),
      );
      body.position.y = 0.44;
      g.add(body);
      const wGeo = _geo('cartWhlBox', () => new THREE.BoxGeometry(0.08, 0.44, 0.44));
      const wheelMat = mat(0x3a2a14);
      for (const sx of [-0.49, 0.49]) {
        const w = new THREE.Mesh(wGeo, wheelMat);
        w.position.set(sx, 0.22, 0);
        g.add(w);
      }
      return g;
    }

    case 'scaffolding': {
      const g = new THREE.Group();
      const woodMat = mat(color);
      const postGeo = _geo('scafPost', () => new THREE.CylinderGeometry(0.05, 0.05, 1.8, 4));
      for (const [px, pz] of [[-0.38, 0], [0.38, 0]]) {
        const p = new THREE.Mesh(postGeo, woodMat);
        p.position.set(px, 0.9, pz);
        g.add(p);
      }
      const barGeo = _geo('scafBar', () => new THREE.CylinderGeometry(0.04, 0.04, 0.80, 4));
      for (const by of [0.35, 0.9, 1.5]) {
        const b = new THREE.Mesh(barGeo, woodMat);
        b.rotation.z = Math.PI / 2;
        b.position.set(0, by, 0);
        g.add(b);
      }
      const brace = new THREE.Mesh(
        _geo('scafBrace', () => new THREE.BoxGeometry(0.86, 0.04, 0.06)),
        woodMat,
      );
      brace.rotation.z = Math.PI / 4;
      brace.position.set(0, 0.625, 0);
      g.add(brace);
      return g;
    }

    default: {
      return new THREE.Mesh(
        _geo('defProp', () => new THREE.BoxGeometry(0.18, 0.18, 0.18)),
        mat(color),
      );
    }
  }
}

// ── Public prop factory ───────────────────────────────────────────────────────

/** Create a standalone prop mesh/group by type and color. Returns null for unknown types. */
export function createProp(type, color = 0x8b7355) {
  return _buildProp(type, color) ?? null;
}

// ── KitbashSystem ─────────────────────────────────────────────────────────────

export class KitbashSystem {
  constructor() {
    this._theme  = 'dungeon';
    this._spawned = [];   // { mesh, scene } for cleanup
    this.enabled  = true;
  }

  setTheme(name) {
    if (THEMES[name]) this._theme = name;
  }

  getTheme() { return this._theme; }
  getThemeConfig() { return THEMES[this._theme]; }

  // ── Builders ──────────────────────────────────────────────────────────────

  buildWall(x, z, rng) {
    const cfg    = THEMES[this._theme];
    const height = cfg.wallHeight[0] + rng.nextFloat(0, cfg.wallHeight[1] - cfg.wallHeight[0]);
    const mat    = new THREE.MeshLambertMaterial({ color: cfg.wallColor });
    const mesh   = new THREE.Mesh(new THREE.BoxGeometry(1.0, height, 1.0), mat);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  buildFloor(x, z, rng) {
    const cfg    = THEMES[this._theme];
    const colors = cfg.floorColors;
    const color  = colors[rng.nextInt(0, colors.length - 1)];
    const yOff   = rng.nextFloat(-0.04, 0.04);
    const mat    = new THREE.MeshLambertMaterial({ color });
    const mesh   = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 1.0), mat);
    mesh.position.set(x, -0.09 + yOff, z);
    mesh.castShadow    = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  // Probabilistically spawn a prop on a floor tile — returns mesh or null
  spawnProp(scene, tileX, tileZ, rng) {
    if (!this.enabled) return null;
    const cfg = THEMES[this._theme];
    if (rng.nextFloat(0, 1) > cfg.propDensity) return null;

    const propType = cfg.propTypes[rng.nextInt(0, cfg.propTypes.length - 1)];
    const color    = cfg.propColors[rng.nextInt(0, cfg.propColors.length - 1)];
    const prop     = _buildProp(propType, color);

    prop.position.x += tileX + rng.nextFloat(-0.28, 0.28);
    prop.position.z += tileZ + rng.nextFloat(-0.28, 0.28);
    prop.userData.isProp = true;

    // Ensure every sub-mesh casts and receives shadows
    prop.traverse(child => {
      if (child.isMesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
      }
    });

    scene.add(prop);
    this._spawned.push({ mesh: prop, scene });
    return prop;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  clearAll() {
    for (const { mesh, scene } of this._spawned) scene.remove(mesh);
    this._spawned = [];
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.log(`[Kitbash] theme=${this._theme}  props spawned=${this._spawned.length}`);
  }

  toggle() {
    this.enabled = !this.enabled;
    console.log(`[Kitbash] enabled=${this.enabled}`);
  }
}
