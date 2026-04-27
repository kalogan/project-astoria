import * as THREE from 'three';
import { findPath } from './pathfinding.js';

const SPEED              = 2.5;
const AGGRO_RADIUS       = 8;
const RECALC_INTERVAL    = 0.5;
const WAYPOINT_THRESHOLD = 0.25;
const ENEMY_COLOR        = 0xff4400;
const ENEMY_MAX_HP       = 100;

function worldToGrid(x, z, offset) {
  return { col: Math.round(x + offset), row: Math.round(z + offset) };
}

function gridToWorld(col, row, offset) {
  return { x: col - offset, z: row - offset };
}

export class Enemy {
  constructor(scene, grid, x, z) {
    this.grid       = grid;
    this.gridOffset = (grid[0].length - 1) / 2;
    this.path       = [];
    this.pathTimer  = 0;
    this.hp         = ENEMY_MAX_HP;
    this.maxHp      = ENEMY_MAX_HP;
    this.alive      = true;
    this.color      = ENEMY_COLOR;

    const geo = new THREE.BoxGeometry(0.6, 0.9, 0.6);
    this.mat  = new THREE.MeshLambertMaterial({ color: ENEMY_COLOR });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(x, 0.65, z);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.alive = false;
      this.mesh.visible = false;
    }
    return !this.alive;
  }

  update(delta, playerPos) {
    if (!this.alive) return;

    const dx   = playerPos.x - this.mesh.position.x;
    const dz   = playerPos.z - this.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > AGGRO_RADIUS) return;

    this.pathTimer -= delta;
    if (this.pathTimer <= 0) {
      const start = worldToGrid(this.mesh.position.x, this.mesh.position.z, this.gridOffset);
      const end   = worldToGrid(playerPos.x, playerPos.z, this.gridOffset);
      this.path   = findPath(this.grid, start.col, start.row, end.col, end.row);
      if (this.path.length > 0) this.path.shift();
      this.pathTimer = RECALC_INTERVAL;
    }

    this._followPath(delta);
  }

  _followPath(delta) {
    if (this.path.length === 0) return;

    const { x: tx, z: tz } = gridToWorld(this.path[0].col, this.path[0].row, this.gridOffset);
    const dx   = tx - this.mesh.position.x;
    const dz   = tz - this.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < WAYPOINT_THRESHOLD) { this.path.shift(); return; }

    const step = Math.min(SPEED * delta, dist);
    this.mesh.position.x += (dx / dist) * step;
    this.mesh.position.z += (dz / dist) * step;
  }
}

export class EnemySystem {
  constructor(scene, grid, defs) {
    this.enemies = defs.map(d => new Enemy(scene, grid, d.x, d.z));
  }

  update(delta, playerPos) {
    for (const enemy of this.enemies) enemy.update(delta, playerPos);
  }

  dispose(scene) {
    for (const e of this.enemies) scene.remove(e.mesh);
    this.enemies = [];
  }
}
