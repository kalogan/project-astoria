import * as THREE from 'three';
import { buildPlayerMesh } from './characterBuilder.js';

const SPEED  = 5;
const MAX_HP = 100;

export class Player {
  constructor(scene, collider) {
    this.collider         = collider;
    this.keys             = {};
    this.interactPressed  = false;
    this.ability1Pressed  = false;  // Q key  → slot 0 (warrior/rogue) / alias for '1'
    this.ability2Pressed  = false;  // F key  → slot 1 (warrior/rogue) / alias for '2'
    // Extended slots 0–4 for mage full kit; pressed flags consumed each frame
    this._abilityPressed  = [false, false, false, false, false];
    this.hp               = MAX_HP;
    this.maxHp            = MAX_HP;
    // Magic Shield — absorbs damage before HP. Set by magic_shield ability.
    this.shield           = 0;
    this.maxShield        = 0;
    this._shieldExpiry    = null;
    // Set externally by ProgressionManager on level_up events
    this.level            = 1;
    // Set externally by BuildManager via main.js on stat changes
    this.speedMultiplier  = 1;
    // Last movement direction (normalized) — used as projectile fallback aim direction
    this._lastMoveDir     = { x: 0, z: -1 };

    // Stable root Group — animation system + combat + HUD all reference this.
    // Character parts (class-specific meshes) live as named children inside it.
    // Replacing the class only swaps children, never the root object.
    this.mesh = new THREE.Group();
    this.mesh.position.set(0, 0.65, 0);
    this.mesh.castShadow = true;
    this._scene = scene;
    scene.add(this.mesh);

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === 'e') this.interactPressed = true;
      // Q / F: legacy aliases → also set _abilityPressed[0] / [1]
      if (k === 'q') { this.ability1Pressed = true; this._abilityPressed[0] = true; }
      if (k === 'f') { this.ability2Pressed = true; this._abilityPressed[1] = true; }
      // Number keys 1–5 for expanded mage kit
      if (k === '1') this._abilityPressed[0] = true;
      if (k === '2') this._abilityPressed[1] = true;
      if (k === '3') this._abilityPressed[2] = true;
      if (k === '4') this._abilityPressed[3] = true;
      if (k === '5') this._abilityPressed[4] = true;
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }

  consumeInteract() {
    const v = this.interactPressed;
    this.interactPressed = false;
    return v;
  }

  consumeAbility1() {
    const v = this.ability1Pressed;
    this.ability1Pressed = false;
    return v;
  }

  consumeAbility2() {
    const v = this.ability2Pressed;
    this.ability2Pressed = false;
    return v;
  }

  /** Consume the pressed flag for slot n (0–4). Returns true if pressed. */
  consumeAbility(n) {
    const v = this._abilityPressed[n] ?? false;
    this._abilityPressed[n] = false;
    return v;
  }

  /**
   * Rebuild the character's visual parts for a given class name.
   * Safe to call multiple times — always removes the previous parts first.
   * The root this.mesh Group is never replaced, so all external references stay valid.
   */
  setClass(className) {
    // Remove the current character parts group (if any)
    const old = this.mesh.getObjectByName('_charParts');
    if (old) this.mesh.remove(old);

    // Build new parts and attach as a named child of the stable root
    const parts = buildPlayerMesh(className);
    parts.name = '_charParts';
    this.mesh.add(parts);

    this._className = className;
  }

  update(delta) {
    const dir = new THREE.Vector3();
    if (this.keys['w']) dir.z -= 1;
    if (this.keys['s']) dir.z += 1;
    if (this.keys['a']) dir.x -= 1;
    if (this.keys['d']) dir.x += 1;

    if (dir.lengthSq() === 0) return;

    // Store last move direction (normalized) for projectile aiming fallback
    const len = dir.length();
    this._lastMoveDir = { x: dir.x / len, z: dir.z / len };

    dir.normalize().multiplyScalar(SPEED * this.speedMultiplier * delta);

    const { x, z } = this.mesh.position;
    if (this.collider.passable(x + dir.x, z))                    this.mesh.position.x += dir.x;
    if (this.collider.passable(this.mesh.position.x, z + dir.z)) this.mesh.position.z += dir.z;
  }
}
