// characterBuilder.js — procedural character mesh builder.
//
// Returns a THREE.Group positioned at origin; callers place it at y=0.65.
//
// ── DESIGN PRINCIPLES ────────────────────────────────────────────────────────
//   Silhouette first:  mage = tall + hat + staff  |  warrior = wide + crest + sword
//   Baked shading:     lower parts darker, upper parts lighter (sky-lit look)
//   Color blocking:    each body region has its own distinct hue/tone
//   Shadow disc:       flat ellipse at y≈-0.63 grounds every character
//   Fresh materials:   each character instance gets its own material objects
//                      so hit-flash can tint it without bleeding to others

import * as THREE from 'three';

// ── Shared geometry cache ─────────────────────────────────────────────────────
// Only SHAPE is cached — materials are always per-instance.
const _G = {};
function _geo(key, factory) {
  return (_G[key] ??= factory());
}

// ── Per-instance material ─────────────────────────────────────────────────────
// Always creates a fresh object so each character can be tinted independently.
function _mat(hex, emHex = 0x000000, emInt = 0) {
  return new THREE.MeshLambertMaterial({
    color:             hex,
    emissive:          emHex,
    emissiveIntensity: emInt,
  });
}

// ── Colour utilities ──────────────────────────────────────────────────────────
function _darken(hex, f) {
  return (
    ((Math.max(0, ((hex >> 16) & 0xff) * f) | 0) << 16) |
    ((Math.max(0, ((hex >>  8) & 0xff) * f) | 0) <<  8) |
     (Math.max(0, ((hex      ) & 0xff) * f) | 0)
  );
}
function _lighten(hex, f) {
  return (
    ((Math.min(255, ((hex >> 16) & 0xff) * f) | 0) << 16) |
    ((Math.min(255, ((hex >>  8) & 0xff) * f) | 0) <<  8) |
     (Math.min(255, ((hex      ) & 0xff) * f) | 0)
  );
}

// ── Shared part builders ──────────────────────────────────────────────────────

/** Flat shadow ellipse at floor level (y ≈ −0.63 relative to group). */
function _addShadow(group, rx = 0.26, rz = 0.26) {
  const m = new THREE.Mesh(
    _geo('shadowDisc', () => new THREE.SphereGeometry(1, 12, 6)),
    new THREE.MeshBasicMaterial({
      color:       0x000000,
      transparent: true,
      opacity:     0.32,
      depthWrite:  false,
    }),
  );
  m.scale.set(rx, 0.055, rz);
  m.position.y        = -0.63;
  m.renderOrder       = 1;
  m.userData.isShadow = true;   // skipped by hitEffectSystem flash traversal
  group.add(m);
}

/** Mark a mesh as shadow-casting and return it (fluent). */
function _cast(mesh) {
  mesh.castShadow    = true;
  mesh.receiveShadow = false;
  return mesh;
}

/** Add a mesh to a group, set its position, and return the group (fluent helper). */
function _add(group, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  group.add(mesh);
  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAGE  — tall + narrow + robe + wizard hat + glowing staff
// ─────────────────────────────────────────────────────────────────────────────
// Baked shading:  boot area = deepest,  robe mid = medium,  chest = brighter,
//                 hat = medium,  hat-top = darkens (like ink tip).
// Silhouette:     staff extends above hat to make mage taller than warrior.

function _buildMage() {
  const g = new THREE.Group();
  _addShadow(g, 0.22, 0.22);

  const C = {
    ROBE_BOT : 0x160c4a,   // deep indigo — hem, most shadowed
    ROBE_MID : 0x201470,   // mid indigo body
    ROBE_LITE: 0x2c1e9a,   // lighter indigo chest (sky-lit)
    BELT     : 0xb08820,   // gold accent belt
    SKIN     : 0xe2bc90,   // warm skin
    WOOD     : 0x6b4a1e,   // staff wood
    ORB      : 0x38c8ff,   // glowing aqua orb
  };

  // Robe lower — wide bell shape, darkest part of character
  _add(g, _cast(new THREE.Mesh(
    _geo('mageRobeLow', () => new THREE.CylinderGeometry(0.09, 0.19, 0.50, 7)),
    _mat(C.ROBE_BOT),
  )), 0, -0.25, 0);

  // Robe upper body
  _add(g, _cast(new THREE.Mesh(
    _geo('mageRobeMid', () => new THREE.CylinderGeometry(0.09, 0.09, 0.24, 7)),
    _mat(C.ROBE_MID),
  )), 0, 0.12, 0);

  // Gold belt — visual break between lower/upper robe
  _add(g, _cast(new THREE.Mesh(
    _geo('mageBelt', () => new THREE.CylinderGeometry(0.097, 0.097, 0.042, 7)),
    _mat(C.BELT),
  )), 0, 0.00, 0);

  // Shoulders — slightly wider, brighter (highest body point before head)
  for (const sx of [-0.12, 0.12]) {
    const m = _cast(new THREE.Mesh(
      _geo('mageShoulder', () => new THREE.SphereGeometry(0.082, 6, 4)),
      _mat(C.ROBE_LITE),
    ));
    m.scale.set(1.1, 0.75, 0.85);
    _add(g, m, sx, 0.22, 0);
  }

  // Head — warm skin tone, spherical (distinct from boxy enemy heads)
  _add(g, _cast(new THREE.Mesh(
    _geo('mageHead', () => new THREE.SphereGeometry(0.112, 8, 6)),
    _mat(C.SKIN),
  )), 0, 0.41, 0);

  // Hat brim — flat disc, dark — frames the face
  _add(g, _cast(new THREE.Mesh(
    _geo('mageHatBrim', () => new THREE.CylinderGeometry(0.17, 0.17, 0.026, 9)),
    _mat(C.ROBE_BOT),
  )), 0, 0.535, 0);

  // Hat cone — tallest part, KEY silhouette identifier
  _add(g, _cast(new THREE.Mesh(
    _geo('mageHatCone', () => new THREE.ConeGeometry(0.12, 0.30, 7)),
    _mat(C.ROBE_MID),
  )), 0, 0.69, 0);

  // Staff — extends well above head to give mage height dominance
  _add(g, _cast(new THREE.Mesh(
    _geo('mageStaff', () => new THREE.CylinderGeometry(0.022, 0.028, 1.18, 5)),
    _mat(C.WOOD),
  )), 0.26, 0.14, 0.04);

  // Staff orb — emissive glow, unique visual call-out for magic class
  _add(g, _cast(new THREE.Mesh(
    _geo('mageOrb', () => new THREE.IcosahedronGeometry(0.068, 0)),
    _mat(C.ORB, C.ORB, 0.90),
  )), 0.26, 0.74, 0.04);

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// WARRIOR — wide + armoured + sword + helmet crest
// ─────────────────────────────────────────────────────────────────────────────
// Silhouette:  shoulders wider than head,  crest adds vertical punch,
//              sword extends to the right to mirror mage's staff.

function _buildWarrior() {
  const g = new THREE.Group();
  _addShadow(g, 0.30, 0.28);

  const C = {
    BOOT  : 0x383030,   // dark leather boots — lowest, most shadowed
    CHAIN : 0x586070,   // chain-mail legs
    PLATE : 0x708090,   // chest plate (mid brightness)
    PAULDRON: 0x8898a8, // shoulder pads — topmost body, brightest metal
    SKIN  : 0xe2bc90,   // face skin
    HELM  : 0x607888,   // steel helmet (slightly cooler than pauldrons)
    BLADE : 0xc8d8e8,   // polished blade
    GUARD : 0x8b7040,   // bronze cross-guard
  };

  // Boots
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorBoots', () => new THREE.BoxGeometry(0.32, 0.16, 0.26)),
    _mat(C.BOOT),
  )), 0, -0.47, 0);

  // Greaves / legs
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorLegs', () => new THREE.BoxGeometry(0.30, 0.26, 0.26)),
    _mat(C.CHAIN),
  )), 0, -0.28, 0);

  // Chest plate — wide (wider than head = warrior silhouette)
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorTorso', () => new THREE.BoxGeometry(0.44, 0.40, 0.32)),
    _mat(C.PLATE),
  )), 0, 0.02, 0);

  // Shoulder pads — protruding, bright metal, define silhouette width
  for (const sx of [-0.29, 0.29]) {
    _add(g, _cast(new THREE.Mesh(
      _geo('warriorShoulder', () => new THREE.BoxGeometry(0.14, 0.11, 0.30)),
      _mat(C.PAULDRON),
    )), sx, 0.21, 0);
  }

  // Neck / skin
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorNeck', () => new THREE.BoxGeometry(0.16, 0.09, 0.17)),
    _mat(C.SKIN),
  )), 0, 0.33, 0);

  // Helmet
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorHelm', () => new THREE.BoxGeometry(0.30, 0.26, 0.28)),
    _mat(C.HELM),
  )), 0, 0.455, 0);

  // Helmet crest — vertical ridge, adds unique warrior height
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorCrest', () => new THREE.BoxGeometry(0.055, 0.17, 0.20)),
    _mat(C.PAULDRON),
  )), 0, 0.65, 0);

  // Sword blade — extends to the right (mirrors mage staff direction)
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorBlade', () => new THREE.BoxGeometry(0.044, 0.54, 0.044)),
    _mat(C.BLADE),
  )), 0.38, 0.14, 0);

  // Cross-guard
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorGuard', () => new THREE.BoxGeometry(0.22, 0.044, 0.055)),
    _mat(C.GUARD),
  )), 0.38, -0.13, 0);

  // Grip
  _add(g, _cast(new THREE.Mesh(
    _geo('warriorGrip', () => new THREE.CylinderGeometry(0.026, 0.026, 0.17, 5)),
    _mat(0x3a2810),
  )), 0.38, -0.23, 0);

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROGUE — slender, dark leather, twin daggers on back, low hood
// ─────────────────────────────────────────────────────────────────────────────

function _buildRogue() {
  const g = new THREE.Group();
  _addShadow(g, 0.20, 0.20);

  const C = {
    BOOT   : 0x1e1c18,   // near-black leather
    LEATHER: 0x352c1c,   // brown leather torso
    HOOD   : 0x221e14,   // dark hood
    SKIN   : 0xe2bc90,
    DAGGER : 0xa8b8c0,   // dull steel
  };

  // Lower body — tapers toward top (cloak silhouette)
  _add(g, _cast(new THREE.Mesh(
    _geo('rogueLegs', () => new THREE.CylinderGeometry(0.08, 0.14, 0.52, 7)),
    _mat(C.BOOT),
  )), 0, -0.26, 0);

  // Torso
  _add(g, _cast(new THREE.Mesh(
    _geo('rogueTorso', () => new THREE.CylinderGeometry(0.09, 0.09, 0.28, 7)),
    _mat(C.LEATHER),
  )), 0, 0.14, 0);

  // Head (skin visible below hood)
  _add(g, _cast(new THREE.Mesh(
    _geo('rogueHead', () => new THREE.SphereGeometry(0.11, 8, 6)),
    _mat(C.SKIN),
  )), 0, 0.42, 0);

  // Hood overlay — key rogue read (slightly larger than head, squashed)
  {
    const m = _cast(new THREE.Mesh(
      _geo('rogueHood', () => new THREE.SphereGeometry(0.132, 8, 5)),
      _mat(C.HOOD),
    ));
    m.scale.set(1.02, 0.70, 1.02);
    _add(g, m, 0, 0.45, -0.018);
  }

  // Twin daggers — crossed on back, handles angled outward
  for (const [sx, rz] of [[ 0.18,  0.32], [-0.18, -0.32]]) {
    const m = _cast(new THREE.Mesh(
      _geo('rogueDagger', () => new THREE.BoxGeometry(0.028, 0.38, 0.026)),
      _mat(C.DAGGER),
    ));
    m.rotation.z = rz;
    _add(g, m, sx, 0.08, -0.055);
  }

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMY — melee grunt, colour-coded per zone, angular boxy head
// ─────────────────────────────────────────────────────────────────────────────

function _buildEnemy(primaryColor) {
  const g = new THREE.Group();
  _addShadow(g, 0.27, 0.25);

  const DARK   = _darken(primaryColor,  0.55);
  const MID    = primaryColor;
  const LIGHT  = _lighten(primaryColor, 1.35);
  const WEAPON = 0x242020;

  // Legs
  _add(g, _cast(new THREE.Mesh(
    _geo('enemyLegs', () => new THREE.BoxGeometry(0.28, 0.24, 0.24)),
    _mat(DARK),
  )), 0, -0.31, 0);

  // Torso — hulking, slightly wider than player warrior
  _add(g, _cast(new THREE.Mesh(
    _geo('enemyTorso', () => new THREE.BoxGeometry(0.38, 0.38, 0.30)),
    _mat(MID),
  )), 0, 0.02, 0);

  // Head — BOXY (vs rounded player head = instant enemy read)
  _add(g, _cast(new THREE.Mesh(
    _geo('enemyHead', () => new THREE.BoxGeometry(0.28, 0.24, 0.25)),
    _mat(LIGHT),
  )), 0, 0.38, 0);

  // Weapon shaft
  _add(g, _cast(new THREE.Mesh(
    _geo('enemyShaft', () => new THREE.CylinderGeometry(0.03, 0.03, 0.55, 4)),
    _mat(0x3a2810),
  )), -0.28, 0.10, 0);

  // Axe head
  _add(g, _cast(new THREE.Mesh(
    _geo('enemyAxeHead', () => new THREE.BoxGeometry(0.14, 0.18, 0.07)),
    _mat(WEAPON),
  )), -0.28, 0.38, 0);

  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const _CLASS_BUILDERS = {
  mage:    _buildMage,
  warrior: _buildWarrior,
  rogue:   _buildRogue,
};

/**
 * Build a procedural player character Group for the given class name.
 * Position the returned group at y = 0.65 in world space.
 */
export function buildPlayerMesh(className) {
  const builder = _CLASS_BUILDERS[className?.toLowerCase()] ?? _CLASS_BUILDERS.warrior;
  return builder();
}

/**
 * Build a procedural enemy character Group using the enemy's primary colour.
 * Position the returned group at y = 0.65 in world space.
 */
export function buildEnemyMesh(primaryColor = 0x8B4513) {
  return _buildEnemy(primaryColor);
}
