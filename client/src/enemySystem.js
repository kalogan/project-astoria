import * as THREE from 'three';
import { findPath }     from './pathfinding.js';
import { buildEnemyMesh } from './characterBuilder.js';

const BASE_SPEED         = 2.5;
const AGGRO_RADIUS       = 8;
const RECALC_INTERVAL    = 0.5;
const WAYPOINT_THRESHOLD = 0.25;
const ATTACK_RANGE_SQ    = 1.5 * 1.5;
const ATTACK_INTERVAL    = 1.5;  // seconds between enemy attacks
export const ENEMY_COLOR  = 0xff4400;
export const ENEMY_MAX_HP = 100;

function worldToGrid(x, z, offset) {
  return { col: Math.round(x + offset), row: Math.round(z + offset) };
}

function gridToWorld(col, row, offset) {
  return { x: col - offset, z: row - offset };
}

// ── Enemy entity ───────────────────────────────────────────────────────────
// Created by ZoneManager, driven by EnemySystem.
// def fields: id, x, z, hp?, speed?, attackDamage?, color?, xpValue?, type?

export class Enemy {
  constructor(scene, grid, def) {
    this.id           = def.id;
    this.type         = def.type         ?? 'melee';
    this.grid         = grid;
    this.gridOffset   = (grid[0].length - 1) / 2;
    this.path         = [];
    this.pathTimer    = 0;
    this.hp           = def.hp           ?? ENEMY_MAX_HP;
    this.maxHp        = def.hp           ?? ENEMY_MAX_HP;
    this.alive        = true;
    this.color        = def.color        ?? ENEMY_COLOR;
    this.xpValue      = def.xpValue      ?? 10;
    this.attackDamage = def.attackDamage ?? 10;
    this._speed       = def.speed        ?? BASE_SPEED;
    this._attackTimer = 0;

    // Procedural character group — parts are built from the enemy's primary colour.
    // Each enemy gets fresh material instances so hit-flash affects only this enemy.
    this.mesh = buildEnemyMesh(this.color);
    this.mesh.position.set(def.x, 0.65, def.z);
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

  // Returns attack damage if an attack fires this frame, otherwise null.
  update(delta, playerPos) {
    if (!this.alive)     return null;
    if (this._stunned)   return null;   // status effect — skip AI entirely

    const dx    = playerPos.x - this.mesh.position.x;
    const dz    = playerPos.z - this.mesh.position.z;
    const dist2 = dx * dx + dz * dz;
    const dist  = Math.sqrt(dist2);

    if (dist > AGGRO_RADIUS) return null;

    // Pathfinding
    this.pathTimer -= delta;
    if (this.pathTimer <= 0) {
      const start = worldToGrid(this.mesh.position.x, this.mesh.position.z, this.gridOffset);
      const end   = worldToGrid(playerPos.x, playerPos.z, this.gridOffset);
      this.path   = findPath(this.grid, start.col, start.row, end.col, end.row);
      if (this.path.length > 0) this.path.shift();
      this.pathTimer = RECALC_INTERVAL;
    }

    this._followPath(delta);

    // Attack
    this._attackTimer = Math.max(0, this._attackTimer - delta);
    if (this._attackTimer === 0 && dist2 <= ATTACK_RANGE_SQ) {
      this._attackTimer = ATTACK_INTERVAL;
      return this.attackDamage;
    }
    return null;
  }

  _followPath(delta) {
    if (this.path.length === 0) return;

    const { x: tx, z: tz } = gridToWorld(this.path[0].col, this.path[0].row, this.gridOffset);
    const dx   = tx - this.mesh.position.x;
    const dz   = tz - this.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < WAYPOINT_THRESHOLD) { this.path.shift(); return; }

    const step = Math.min(this._speed * delta, dist);
    this.mesh.position.x += (dx / dist) * step;
    this.mesh.position.z += (dz / dist) * step;
  }
}

// ── EnemySystem ────────────────────────────────────────────────────────────
// Pure behavior driver — no entity ownership.

export class EnemySystem {
  constructor(player) {
    this.player    = player;
    this.build     = null;   // set externally from main.js
    this.aiSystem  = null;   // set externally from main.js for enhanced AI
    this.registry  = null;
    this._eventBus = null;
    this.rng       = null;
  }

  init(_zone, registry, eventBus, rng = null) {
    this.registry  = registry;
    this._eventBus = eventBus;
    this.rng       = rng;
  }

  update(delta) {
    if (!this.registry) return;
    const pos = this.player.mesh.position;

    for (const e of this.registry.getEntitiesByType('enemy')) {
      // Delegate to aiSystem when available, fall back to built-in chase logic
      const raw = this.aiSystem
        ? this.aiSystem.updateEnemy(e, delta, pos)
        : e.update(delta, pos);

      if (raw !== null) {
        const reduction = this.build?.getDamageReduction() ?? 0;
        const dmg       = Math.max(1, Math.floor(raw * (1 - reduction)));
        this.player.hp  = Math.max(0, this.player.hp - dmg);
        this._eventBus?.emit('player_damaged', {
          damage:  dmg,
          hp:      this.player.hp,
          enemyId: e.id,
        });
      }
    }
  }

  onEvent(_event) {}
}
