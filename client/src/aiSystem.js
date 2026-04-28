// AI system — state-machine decision engine for enemies.
//
// Replaces Enemy.update()'s simple chase+attack with type-aware behaviours:
//   idle → patrol → aggro → attack → retreat
//
// EnemySystem.update() delegates to aiSystem.updateEnemy() when wired.
// Throttled: each enemy AI decision ticks at most every AI_TICK_INTERVAL s.
// Movement and attacks still resolve every frame for smooth motion.

import { findPath } from './pathfinding.js';

// ── Tuning constants ──────────────────────────────────────────────────────────

const AI_TICK_INTERVAL = 0.15;  // state-machine decision rate
const PATH_RECALC      = 0.45;  // pathfinding recalc interval
const AGGRO_RADIUS     = 8.0;   // distance at which idle enemies spot player
const DEAGGRO_RADIUS   = 14.0;  // distance at which enemies give up
const SPREAD_RADIUS_SQ = 4 * 4; // group-aggro spread radius²
const PATROL_RADIUS    = 3.0;   // wander distance from spawn

// Per-type attack range (units)
const ATTACK_RANGE = { melee: 1.6, ranged: 5.5, tank: 1.9, support: 2.0 };
// Preferred engagement distance for ranged / support
const PREFERRED_DIST = { ranged: 4.5, support: 5.0 };
// HP fraction below which an enemy retreats
const RETREAT_HP = { melee: 0.15, ranged: 0.30, tank: 0.08, support: 0.20 };
// Attack cooldown by type (seconds)
const ATTACK_CD  = { melee: 1.5,  ranged: 2.0,  tank: 2.5,  support: 3.5 };

// Stagger initial tick timers so all enemies don't decide on the same frame
let _seq = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _dist(a, b)  { const dx = b.x - a.x, dz = b.z - a.z; return Math.sqrt(dx * dx + dz * dz); }
function _dist2(a, b) { const dx = b.x - a.x, dz = b.z - a.z; return dx * dx + dz * dz; }

function _worldToGrid(x, z, offset) {
  return { col: Math.round(x + offset), row: Math.round(z + offset) };
}

function _gridToWorld(col, row, offset) {
  return { x: col - offset, z: row - offset };
}

function _freshAI(seq) {
  return {
    state:          'idle',
    target:         null,
    tickTimer:      (seq % 12) * (AI_TICK_INTERVAL / 12), // phase-stagger
    pathTimer:      0,
    patrolTarget:   null,
    patrolTimer:    0,
    patrolPhase:    seq * 137.508, // golden-angle offset for spread wander
    supportCDTimer: 0,
    spawnX:         null,
    spawnZ:         null,
  };
}

// ── AISystem ──────────────────────────────────────────────────────────────────

export class AISystem {
  constructor() {
    this._states   = new Map(); // enemyId → AIState
    this._registry = null;
    this._eventBus = null;
    this._rng      = null;
    this.enabled   = true;

    // Exposed so modifiers can override (e.g. "Darkness" mod reduces radius)
    this.aggroRadius   = AGGRO_RADIUS;
    this.deaggroRadius = DEAGGRO_RADIUS;
  }

  init(_zone, registry, eventBus, rng = null) {
    this._registry = registry;
    this._eventBus = eventBus;
    this._rng      = rng;
    this._states.clear();
    this.aggroRadius   = AGGRO_RADIUS;
    this.deaggroRadius = DEAGGRO_RADIUS;

    this._unsub?.();
    this._unsub = eventBus.on('enemy_damaged', ({ payload }) => {
      this._onEnemyDamaged(payload.enemyId);
    });
  }

  onEvent() {}

  // ── Public: per-enemy update (called by EnemySystem) ─────────────────────

  // Returns attack damage (number) or null, same contract as Enemy.update().
  updateEnemy(enemy, delta, playerPos) {
    if (!enemy.alive) return null;

    const ai = this._getAI(enemy);

    // Record spawn position on first call
    if (ai.spawnX === null) {
      ai.spawnX = enemy.mesh.position.x;
      ai.spawnZ = enemy.mesh.position.z;
    }

    const dist = _dist(enemy.mesh.position, playerPos);

    // Throttled decision tick
    ai.tickTimer -= delta;
    if (ai.tickTimer <= 0) {
      ai.tickTimer = AI_TICK_INTERVAL;
      this._decide(enemy, ai, dist, playerPos);
    }

    // Execute current state every frame
    return this._execute(enemy, ai, delta, dist, playerPos);
  }

  // Force an enemy into aggro (used by encounterSystem)
  forceAggro(enemy) {
    const ai = this._getAI(enemy);
    this._enterAggro(enemy, ai);
  }

  setAggroRadius(r) { this.aggroRadius = r; }

  // ── Decision tick ─────────────────────────────────────────────────────────

  _decide(enemy, ai, dist, playerPos) {
    const hpPct    = enemy.hp / enemy.maxHp;
    const retreatAt = RETREAT_HP[enemy.type] ?? 0.15;

    switch (ai.state) {
      case 'idle':
        if (dist < this.aggroRadius) {
          this._enterAggro(enemy, ai);
          this._spreadAggro(enemy, playerPos);
        }
        break;

      case 'patrol':
        if (dist < this.aggroRadius) {
          this._enterAggro(enemy, ai);
          this._spreadAggro(enemy, playerPos);
        } else {
          ai.patrolTimer -= AI_TICK_INTERVAL;
          if (ai.patrolTimer <= 0) this._pickPatrolTarget(ai);
        }
        break;

      case 'aggro':
        if (dist > this.deaggroRadius) {
          ai.state = 'idle'; ai.target = null;
        } else if (this._inRange(enemy, dist)) {
          ai.state = 'attack';
        }
        if (hpPct < retreatAt) ai.state = 'retreat';
        break;

      case 'attack':
        if (dist > this.deaggroRadius) {
          ai.state = 'idle'; ai.target = null;
        } else if (!this._inRange(enemy, dist) && enemy.type !== 'ranged') {
          ai.state = 'aggro';
        }
        if (hpPct < retreatAt) ai.state = 'retreat';
        break;

      case 'retreat':
        // Re-engage once partially recovered or target left range
        if (hpPct > retreatAt + 0.12 || dist > this.deaggroRadius) {
          ai.state = dist < this.aggroRadius ? 'aggro' : 'idle';
        }
        break;
    }
  }

  // ── State execution ───────────────────────────────────────────────────────

  _execute(enemy, ai, delta, dist, playerPos) {
    switch (ai.state) {
      case 'idle':    return null;
      case 'patrol':  this._runPatrol(enemy, ai, delta); return null;
      case 'aggro':   this._runAggro(enemy, ai, delta, dist, playerPos); return null;
      case 'attack':  return this._runAttack(enemy, ai, delta, dist, playerPos);
      case 'retreat': this._moveAway(enemy, ai, delta, playerPos); return null;
    }
    return null;
  }

  _runPatrol(enemy, ai, delta) {
    if (!ai.patrolTarget) {
      this._pickPatrolTarget(ai);
      if (!ai.patrolTarget) return;
    }
    const d = _dist(enemy.mesh.position, ai.patrolTarget);
    if (d < 0.4) { ai.patrolTarget = null; return; }
    this._moveTo(enemy, ai, delta, ai.patrolTarget);
  }

  _runAggro(enemy, ai, delta, dist, playerPos) {
    if (enemy.type === 'ranged') {
      // Approach only until preferred distance
      if (dist > PREFERRED_DIST.ranged + 1) this._moveTo(enemy, ai, delta, playerPos);
      if (this._inRange(enemy, dist)) { ai.state = 'attack'; return; }
    } else {
      this._moveTo(enemy, ai, delta, playerPos);
      if (this._inRange(enemy, dist)) { ai.state = 'attack'; return; }
    }
  }

  _runAttack(enemy, ai, delta, dist, playerPos) {
    switch (enemy.type) {
      case 'ranged': {
        const pref = PREFERRED_DIST.ranged;
        if (dist < pref - 1.2)      this._moveAway(enemy, ai, delta, playerPos);
        else if (dist > pref + 1.5) this._moveTo(enemy, ai, delta, playerPos);
        break;
      }
      case 'tank':
        // Slow but relentless — always closes in
        if (dist > ATTACK_RANGE.tank) this._moveTo(enemy, ai, delta, playerPos);
        break;
      case 'support':
        // Stay back, buff allies
        this._runSupport(enemy, ai, delta, playerPos);
        break;
      default: // melee
        if (dist > ATTACK_RANGE.melee) this._moveTo(enemy, ai, delta, playerPos);
    }

    return this._tryAttack(enemy, delta, dist);
  }

  _runSupport(enemy, ai, delta, playerPos) {
    // Keep distance
    const pref = PREFERRED_DIST.support;
    if (_dist(enemy.mesh.position, playerPos) < pref) {
      this._moveAway(enemy, ai, delta, playerPos);
    }

    // Buff nearby allies periodically
    ai.supportCDTimer -= delta;
    if (ai.supportCDTimer <= 0 && this._registry) {
      ai.supportCDTimer = 8;
      let buffed = 0;
      for (const other of this._registry.getEntitiesByType('enemy')) {
        if (!other.alive || other.id === enemy.id) continue;
        if (_dist2(enemy.mesh.position, other.mesh.position) > 5 * 5) continue;
        // Temporary +25% damage boost tracked by a timer on the entity
        other._supportBuff = (other._supportBuff ?? 0) + 3.0; // 3-second duration
        if (!other._originalAttack) other._originalAttack = other.attackDamage;
        other.attackDamage = Math.floor(other._originalAttack * 1.25);
        buffed++;
      }
      if (buffed > 0) {
        this._eventBus?.emit('support_buff', { enemyId: enemy.id, count: buffed });
      }
    }

    // Decay support buffs
    for (const other of this._registry?.getEntitiesByType('enemy') ?? []) {
      if (!other._supportBuff) continue;
      other._supportBuff -= delta;
      if (other._supportBuff <= 0) {
        other._supportBuff  = 0;
        other.attackDamage  = other._originalAttack ?? other.attackDamage;
        other._originalAttack = null;
      }
    }
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  _moveTo(enemy, ai, delta, targetPos) {
    ai.pathTimer -= delta;
    if (ai.pathTimer <= 0) {
      ai.pathTimer = PATH_RECALC;
      const off   = enemy.gridOffset;
      const start = _worldToGrid(enemy.mesh.position.x, enemy.mesh.position.z, off);
      const end   = _worldToGrid(targetPos.x, targetPos.z, off);
      enemy.path  = findPath(enemy.grid, start.col, start.row, end.col, end.row);
      if (enemy.path.length > 0) enemy.path.shift();
    }
    this._followPath(enemy, delta);
  }

  _moveAway(enemy, ai, delta, fromPos) {
    const ep = enemy.mesh.position;
    const dx = ep.x - fromPos.x;
    const dz = ep.z - fromPos.z;
    const d  = Math.sqrt(dx * dx + dz * dz) || 1;
    const retreat = { x: ep.x + (dx / d) * 5, z: ep.z + (dz / d) * 5 };
    this._moveTo(enemy, ai, delta, retreat);
  }

  _followPath(enemy, delta) {
    if (!enemy.path?.length) return;
    const WP_THRESH = 0.25;
    const wp = enemy.path[0];
    const { x: tx, z: tz } = _gridToWorld(wp.col, wp.row, enemy.gridOffset);
    const dx   = tx - enemy.mesh.position.x;
    const dz   = tz - enemy.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < WP_THRESH) { enemy.path.shift(); return; }
    const step = Math.min(enemy._speed * delta, dist);
    enemy.mesh.position.x += (dx / dist) * step;
    enemy.mesh.position.z += (dz / dist) * step;
  }

  // ── Attack ────────────────────────────────────────────────────────────────

  _tryAttack(enemy, delta, dist) {
    enemy._attackTimer = Math.max(0, enemy._attackTimer - delta);
    if (enemy._attackTimer > 0) return null;
    const range = ATTACK_RANGE[enemy.type] ?? ATTACK_RANGE.melee;
    if (dist > range) return null;
    enemy._attackTimer = ATTACK_CD[enemy.type] ?? ATTACK_CD.melee;
    return enemy.attackDamage;
  }

  // ── Group behaviour ───────────────────────────────────────────────────────

  _enterAggro(enemy, ai) {
    ai.state  = 'aggro';
    ai.target = 'player';
    this._eventBus?.emit('enemy_aggro', { enemyId: enemy.id });
  }

  _spreadAggro(source, playerPos) {
    if (!this._registry) return;
    for (const other of this._registry.getEntitiesByType('enemy')) {
      if (!other.alive || other.id === source.id) continue;
      if (_dist2(source.mesh.position, other.mesh.position) > SPREAD_RADIUS_SQ) continue;
      const otherAI = this._getAI(other);
      if (otherAI.state === 'idle' || otherAI.state === 'patrol') {
        this._enterAggro(other, otherAI);
      }
    }
  }

  // ── Patrol ────────────────────────────────────────────────────────────────

  _pickPatrolTarget(ai) {
    if (ai.spawnX === null) return;
    ai.patrolPhase += 137.508; // golden-angle step for spread
    const angle = (ai.patrolPhase * Math.PI) / 180;
    const r     = PATROL_RADIUS * 0.6;
    ai.patrolTarget = { x: ai.spawnX + Math.cos(angle) * r, z: ai.spawnZ + Math.sin(angle) * r };
    ai.patrolTimer  = 4;
  }

  // ── Damage reaction ───────────────────────────────────────────────────────

  _onEnemyDamaged(enemyId) {
    const enemy = this._registry?.getEntityById(enemyId);
    if (!enemy) return;
    const ai = this._getAI(enemy);
    if (ai.state === 'idle' || ai.state === 'patrol') this._enterAggro(enemy, ai);
  }

  // ── Util ──────────────────────────────────────────────────────────────────

  _getAI(enemy) {
    if (!this._states.has(enemy.id)) {
      this._states.set(enemy.id, _freshAI(_seq++));
    }
    return this._states.get(enemy.id);
  }

  _inRange(enemy, dist) {
    return dist <= (ATTACK_RANGE[enemy.type] ?? ATTACK_RANGE.melee);
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    const counts = {};
    for (const s of this._states.values()) {
      counts[s.state] = (counts[s.state] ?? 0) + 1;
    }
    console.log('[AI] States:', counts);
  }

  logEnemy(id) {
    const ai = this._states.get(id);
    if (!ai) { console.log(`[AI] No state for ${id}`); return; }
    console.log(`[AI] ${id}:`, ai.state, '→ target:', ai.target);
  }

  toggle() {
    this.enabled = !this.enabled;
    console.log(`[AI] enabled=${this.enabled}`);
  }
}
