// lightningPulseSystem.js — timed orbiting lightning pulse.
//
// When activated the system spawns 1–3 orbit nodes that spin around the player's
// head.  Each tick, nearby enemies are checked; on proximity a lightning strike
// visual is drawn from the nearest node to the enemy and damage is applied.
//
// ── BEHAVIOR OVERVIEW ────────────────────────────────────────────────────────
//   Activation  → lightningPulse.activate(duration, nodeCount, damage)
//   Each frame  → nodes orbit player (circular XZ motion, fixed Y head-height)
//   Hit check   → enemies within HIT_RADIUS are struck
//   Per-target cooldown prevents the same enemy being zapped every frame
//   Expiration  → orbit nodes removed, lightning cleared, event emitted
//
// ── ORBIT MATH ───────────────────────────────────────────────────────────────
//   x = player.x + cos(angle + nodeOffset) * orbitRadius
//   z = player.z + sin(angle + nodeOffset) * orbitRadius
//   y = player.y + mesh.height/2 + HEAD_OFFSET
//
// ── LIGHTNING STRIKE ─────────────────────────────────────────────────────────
//   A pre-allocated CylinderGeometry mesh is stretched and positioned between
//   the orbit node and the enemy center each time a hit occurs.
//   It's made visible for STRIKE_DURATION seconds then hidden again.
//   No new geometry is allocated per strike — same pool reused.
//
// ── PERFORMANCE ──────────────────────────────────────────────────────────────
//   Orbit nodes: max 3 meshes, allocated at construction, shown/hidden.
//   Lightning meshes: max 3 (one per node), allocated at construction.
//   Hit cooldowns: Map<enemyId, remaining> — cleared on deactivation.

import * as THREE from 'three';

const MAX_NODES       = 3;
const ORBIT_RADIUS    = 1.3;   // world units
const ORBIT_SPEED     = 3.2;   // radians per second
const HEAD_OFFSET     = 0.5;   // above mesh centre (player mesh height ~0.9)
const HIT_RADIUS      = 2.0;   // enemies within this distance get struck
const HIT_RADIUS_SQ   = HIT_RADIUS * HIT_RADIUS;
const HIT_COOLDOWN    = 0.28;  // seconds between hits on the SAME enemy
const STRIKE_DURATION = 0.09;  // seconds a lightning line is visible

// Node glow color
const NODE_COLOR      = 0xaaddff;
// Lightning line color
const BOLT_COLOR      = 0xffffff;

export class LightningPulseSystem {
  constructor(scene) {
    this._scene    = scene;
    this._registry = null;
    this._eventBus = null;
    this._player   = null;
    this._debug    = false;

    this._active      = false;
    this._timer       = 0;       // remaining duration (seconds)
    this._angle       = 0;       // current orbit angle
    this._nodeCount   = 0;       // active nodes this pulse
    this._damage      = 0;       // damage per strike
    this._executions  = 0;       // debug counter

    // Per-enemy hit cooldown: enemyId → remaining seconds
    this._hitCooldowns = new Map();

    // Pre-allocate orbit node meshes (never re-created)
    this._nodes   = [];
    this._bolts   = [];
    this._boltTimers = [];   // remaining visibility time per bolt
    this._initMeshes(scene);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setContext({ scene, player }) {
    this._scene  = scene ?? this._scene;
    this._player = player;
  }

  init(_zone, registry, eventBus) {
    this._registry = registry;
    this._eventBus = eventBus;
    if (this._active) this.deactivate(false); // clean up on zone change
  }

  onEvent() {}

  update(delta) {
    if (!this._active || !this._player) return;

    // ── Tick duration ──────────────────────────────────────────────────────
    this._timer -= delta;
    if (this._timer <= 0) {
      this.deactivate(true);
      return;
    }

    const pp = this._player.mesh?.position;
    if (!pp) return;

    // ── Tick orbit angle ───────────────────────────────────────────────────
    this._angle += ORBIT_SPEED * delta;

    // ── Update node positions ──────────────────────────────────────────────
    const baseY = pp.y + HEAD_OFFSET;
    for (let i = 0; i < this._nodeCount; i++) {
      const ang = this._angle + (i * Math.PI * 2) / this._nodeCount;
      this._nodes[i].position.set(
        pp.x + Math.cos(ang) * ORBIT_RADIUS,
        baseY,
        pp.z + Math.sin(ang) * ORBIT_RADIUS,
      );
    }

    // ── Tick hit cooldowns ─────────────────────────────────────────────────
    for (const [id, cd] of this._hitCooldowns) {
      const next = cd - delta;
      if (next <= 0) this._hitCooldowns.delete(id);
      else           this._hitCooldowns.set(id, next);
    }

    // ── Tick bolt timers ───────────────────────────────────────────────────
    for (let i = 0; i < MAX_NODES; i++) {
      if (this._boltTimers[i] > 0) {
        this._boltTimers[i] -= delta;
        if (this._boltTimers[i] <= 0) this._bolts[i].visible = false;
      }
    }

    // ── Strike check ───────────────────────────────────────────────────────
    for (const e of this._registry?.getEntitiesByType('enemy') ?? []) {
      if (!e.alive) continue;
      if (this._hitCooldowns.has(e.id)) continue;

      const dx = e.mesh.position.x - pp.x;
      const dz = e.mesh.position.z - pp.z;
      if (dx * dx + dz * dz > HIT_RADIUS_SQ) continue;

      // Find nearest orbit node to this enemy for the bolt origin
      let nearestNode = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < this._nodeCount; i++) {
        const nd = this._nodes[i];
        const ex = e.mesh.position.x - nd.position.x;
        const ez = e.mesh.position.z - nd.position.z;
        const d  = ex * ex + ez * ez;
        if (d < nearestDist) { nearestDist = d; nearestNode = i; }
      }

      this._strike(e, nearestNode);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start the lightning pulse.
   * @param {number} duration   — total seconds the effect lasts
   * @param {number} nodeCount  — 1–3 orbit nodes
   * @param {number} damage     — damage per strike
   */
  activate(duration, nodeCount, damage) {
    this._timer      = Math.max(0.1, duration);
    this._nodeCount  = Math.max(1, Math.min(MAX_NODES, nodeCount));
    this._damage     = damage;
    this._angle      = 0;
    this._active     = true;
    this._executions = 0;
    this._hitCooldowns.clear();

    // Show orbit nodes
    for (let i = 0; i < MAX_NODES; i++) {
      this._nodes[i].visible = i < this._nodeCount;
    }

    this._eventBus?.emit('lightning_pulse_started', { duration, nodeCount, damage });
    if (this._debug) console.log(`[LightningPulse] activated  dur=${duration.toFixed(1)}s  nodes=${nodeCount}  dmg=${damage}`);
  }

  /**
   * Stop the pulse early or on expiration.
   * @param {boolean} emitEvent — false when called from init (zone reload)
   */
  deactivate(emitEvent = true) {
    this._active = false;
    this._timer  = 0;
    this._hitCooldowns.clear();

    for (let i = 0; i < MAX_NODES; i++) {
      this._nodes[i].visible = false;
      this._bolts[i].visible = false;
      this._boltTimers[i]    = 0;
    }

    if (emitEvent) {
      this._eventBus?.emit('lightning_pulse_ended', { strikes: this._executions });
      if (this._debug) console.log(`[LightningPulse] ended  total strikes=${this._executions}`);
    }
  }

  isActive() { return this._active; }

  // ── Private ────────────────────────────────────────────────────────────────

  _initMeshes(scene) {
    if (!scene) return;

    // Orbit nodes — small glowing tetrahedra
    const nodeGeo = new THREE.OctahedronGeometry(0.14, 0);
    for (let i = 0; i < MAX_NODES; i++) {
      const mat  = new THREE.MeshBasicMaterial({ color: NODE_COLOR, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(nodeGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this._nodes.push(mesh);
    }

    // Lightning bolts — thin cylinders stretched from node to enemy
    const boltGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 4);
    for (let i = 0; i < MAX_NODES; i++) {
      const mat  = new THREE.MeshBasicMaterial({ color: BOLT_COLOR, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(boltGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this._bolts.push(mesh);
      this._boltTimers.push(0);
    }
  }

  _strike(enemy, nodeIdx) {
    // Apply damage
    const dead = enemy.takeDamage(this._damage);
    this._eventBus?.emit('enemy_damaged', {
      enemyId:  enemy.id,
      amount:   this._damage,
      isCrit:   false,
      position: { x: enemy.mesh.position.x, y: enemy.mesh.position.y, z: enemy.mesh.position.z },
    });
    if (dead) this._eventBus?.emit('enemy_killed', _killPayload(enemy));

    // Per-enemy cooldown
    this._hitCooldowns.set(enemy.id, HIT_COOLDOWN);
    this._executions++;

    // Show bolt from node to enemy
    this._showBolt(nodeIdx, this._nodes[nodeIdx].position, enemy.mesh.position);

    if (this._debug) console.log(`[LightningPulse] struck "${enemy.id}" dmg=${this._damage}`);
  }

  _showBolt(nodeIdx, from, to) {
    const bolt = this._bolts[nodeIdx];

    // Midpoint
    const mx = (from.x + to.x) * 0.5;
    const my = (from.y + to.y) * 0.5;
    const mz = (from.z + to.z) * 0.5;

    // Length
    const dx  = to.x - from.x;
    const dy  = to.y - from.y;
    const dz  = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

    bolt.position.set(mx, my, mz);
    bolt.scale.y = len;  // cylinder is 1 unit tall along Y by default

    // Orient cylinder from → to using quaternion
    const dir    = new THREE.Vector3(dx, dy, dz).normalize();
    const up     = new THREE.Vector3(0, 1, 0);
    const quat   = new THREE.Quaternion().setFromUnitVectors(up, dir);
    bolt.setRotationFromQuaternion(quat);

    bolt.visible            = true;
    this._boltTimers[nodeIdx] = STRIKE_DURATION;
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  setDebug(on = true) { this._debug = on; }

  inspect() {
    console.group('[LightningPulse]');
    console.log(`active    : ${this._active}`);
    console.log(`timer     : ${this._timer.toFixed(2)}s remaining`);
    console.log(`nodes     : ${this._nodeCount}`);
    console.log(`damage    : ${this._damage}`);
    console.log(`strikes   : ${this._executions}`);
    console.log(`on cd     : ${this._hitCooldowns.size} enemies`);
    console.groupEnd();
  }

  /** Force-activate for debug testing: __debug.pulse.test() */
  test(duration = 3, nodeCount = 2, damage = 25) {
    this.activate(duration, nodeCount, damage);
    console.log(`[LightningPulse] test: ${duration}s, ${nodeCount} nodes, ${damage} dmg`);
  }

  /** Force-stop: __debug.pulse.stop() */
  stop() { this.deactivate(true); }
}

function _killPayload(e) {
  return {
    enemyId:  e.id,
    id:       e.id,
    xpValue:  e.xpValue ?? 10,
    x:        e.mesh.position.x,
    z:        e.mesh.position.z,
    position: e.mesh.position,
  };
}
