// Dungeon manager — creates self-contained, replayable dungeon instances.
//
// Each instance is a sequence of generated zones:
//   entry zone → progression rooms → boss zone
//
// Player state is snapshotted on entry and restored on exit.
// Dungeon state (enemies, loot) does NOT persist to localStorage.
// Only rewards (XP, gold) flow back into the main progression systems.

import { generateZone }   from './zoneGenerator.js';
import { getTemplate }    from './zoneTemplates.js';
import { enrichZone }     from './contentGenerator.js';

const DIFFICULTY_KEY = 'astoria_difficulty';

// ── DungeonManager ────────────────────────────────────────────────────────────

export class DungeonManager {
  constructor(zoneManager) {
    this._zoneMgr        = zoneManager;
    this._instances      = new Map(); // instanceId → DungeonInstance
    this._active         = null;      // currently running instance
    this._playerSnap     = null;      // player state before entering
    this._eventBus       = null;
    this._diffMgr        = null;      // optional DifficultyManager reference
    this._modMgr         = null;      // optional ModifierSystem reference
  }

  // Wire optional dependencies
  setDifficultyManager(dm) { this._diffMgr = dm; }
  setModifierSystem(mm)    { this._modMgr  = mm; }

  init(eventBus) {
    this._eventBus = eventBus;

    eventBus.on('player_damaged', ({ payload }) => {
      if (payload.hp <= 0 && this._active) this._failDungeon();
    });

    eventBus.on('zone_state_changed', ({ payload }) => {
      if (!this._active) return;
      const inst = this._active;
      const zone = inst.zones[inst.currentIndex];
      if (payload.state === 'cleared' && zone && payload.zoneId === zone.id) {
        this._onZoneCleared();
      }
    });
  }

  // ── Instance creation ─────────────────────────────────────────────────────

  createInstance(config = {}) {
    const seed       = config.seed       ?? (Date.now() & 0x7FFFFFFF);
    const roomCount  = config.roomCount  ?? 3;
    const difficulty = config.difficulty ?? this._diffMgr?.getTier() ?? 1;
    const template   = config.template   ?? 'dungeon';
    const modifiers  = config.modifiers  ?? this._modMgr?.rollModifiers(difficulty) ?? [];

    const instanceId = `dungeon_${seed}_${Date.now() & 0xFFFF}`;
    const scaling    = this._diffMgr?.getScaling() ?? _defaultScaling(difficulty);

    // Generate zone definitions (layout + content)
    const zones = [];
    for (let i = 0; i < roomCount; i++) {
      const zoneId = `${instanceId}_room${i}`;
      const isBoss = i === roomCount - 1;
      const zSeed  = (seed + i * 0x9E3779B9) & 0x7FFFFFFF;

      const diff = isBoss ? 'boss' : difficulty >= 3 ? 'hard' : difficulty >= 2 ? 'medium' : 'easy';
      const tmpl = getTemplate(isBoss ? 'dungeon' : template) ?? getTemplate('dungeon');
      const constraints = {
        minEnemies: 3 + Math.floor(scaling.enemyCountBonus),
        maxEnemies: 8 + Math.floor(scaling.enemyCountBonus * 2),
        hasBossRoom: isBoss,
      };

      const zoneObj = generateZone(
        { id: zoneId, width: 30, height: 30, seed: zSeed },
        tmpl,
        constraints,
      );

      // Apply difficulty scaling to enemy stats
      if (zoneObj.systems?.enemies) {
        for (const e of zoneObj.systems.enemies) {
          e.hp           = Math.floor((e.hp           ?? 80)  * scaling.enemyHpMult);
          e.attackDamage = Math.floor((e.attackDamage ?? 10)  * scaling.enemyDamageMult);
        }
      }

      // Enrich with typed content
      enrichZone(zoneObj, { zoneType: 'dungeon', difficulty: diff, seed: zSeed });

      // Link zones via portals: each room's portal leads to the next
      if (i < roomCount - 1) {
        zoneObj.systems = zoneObj.systems ?? {};
        zoneObj.systems.portals = [{
          id:         `portal_${zoneId}_to_${instanceId}_room${i + 1}`,
          targetZone: `${instanceId}_room${i + 1}`,
          x: 0, z: -8,
        }];
      }

      // Register zone in zone manager's cache
      this._zoneMgr._generatedZones.set(zoneId, zoneObj);

      zones.push({ id: zoneId, isEntry: i === 0, isBoss, difficulty: diff });
    }

    const instance = {
      instanceId,
      seed,
      zones,
      currentIndex:   0,
      state:          'ready',
      difficulty,
      modifiers,
      scaling,
      killCount:      0,
      startTime:      0,
    };

    this._instances.set(instanceId, instance);
    console.log(`[Dungeon] Created instance ${instanceId} (${roomCount} rooms, tier ${difficulty})`);
    return instance;
  }

  // ── Enter / exit ──────────────────────────────────────────────────────────

  async enter(instanceIdOrInstance, player) {
    const inst = typeof instanceIdOrInstance === 'string'
      ? this._instances.get(instanceIdOrInstance)
      : instanceIdOrInstance;

    if (!inst) { console.warn('[Dungeon] Unknown instance'); return; }
    if (inst.state === 'active') { console.warn('[Dungeon] Already in this instance'); return; }

    // Snapshot player state for restoration on exit
    this._playerSnap = {
      x:     player.mesh.position.x,
      y:     player.mesh.position.y,
      z:     player.mesh.position.z,
      hp:    player.hp,
      zoneId: this._zoneMgr.activeId,
    };

    inst.state        = 'active';
    inst.currentIndex = 0;
    inst.killCount    = 0;
    inst.startTime    = Date.now();
    this._active      = inst;

    // Apply modifiers
    this._modMgr?.applyAll(inst.modifiers, {
      registry: this._zoneMgr.registry,
      eventBus: this._eventBus,
    });

    await this._zoneMgr.load(inst.zones[0].id);

    this._eventBus?.emit('dungeon_started', {
      instanceId: inst.instanceId,
      seed:       inst.seed,
      difficulty: inst.difficulty,
      modifiers:  inst.modifiers.map(m => m.name ?? m.id),
    });

    console.log(`[Dungeon] Entered ${inst.instanceId}`);
  }

  async exit(player) {
    if (!this._active) { console.warn('[Dungeon] Not in a dungeon'); return; }

    const snap = this._playerSnap;
    this._modMgr?.removeAll(this._active.modifiers);
    this._active = null;

    if (snap?.zoneId) {
      await this._zoneMgr.load(snap.zoneId);
      player.mesh.position.set(snap.x, snap.y, snap.z);
      player.hp = Math.max(1, snap.hp);
    }

    this._eventBus?.emit('dungeon_exited', {});
    this._playerSnap = null;
    console.log('[Dungeon] Exited to overworld');
  }

  getActiveInstance() { return this._active; }
  isInDungeon()       { return !!this._active; }

  // ── Zone progression ──────────────────────────────────────────────────────

  _onZoneCleared() {
    const inst = this._active;
    if (!inst) return;

    const nextIdx = inst.currentIndex + 1;
    if (nextIdx >= inst.zones.length) {
      this._completeDungeon();
      return;
    }

    inst.currentIndex = nextIdx;
    const nextZone    = inst.zones[nextIdx];

    this._eventBus?.emit('dungeon_room_cleared', {
      instanceId: inst.instanceId,
      nextZone:   nextZone.id,
      isBoss:     nextZone.isBoss,
    });

    this._zoneMgr.load(nextZone.id);
  }

  // ── Completion / failure ──────────────────────────────────────────────────

  _completeDungeon() {
    const inst = this._active;
    if (!inst) return;

    inst.state = 'completed';
    this._modMgr?.removeAll(inst.modifiers);

    const duration    = Math.floor((Date.now() - inst.startTime) / 1000);
    const s           = inst.scaling;
    const xpReward    = Math.floor((60 + inst.killCount * 8) * (s.xpMultiplier  ?? 1));
    const goldReward  = Math.floor((40 + inst.killCount * 4) * (s.lootMultiplier ?? 1));

    this._eventBus?.emit('dungeon_completed', {
      instanceId: inst.instanceId,
      duration,
      kills:      inst.killCount,
      xpReward,
      goldReward,
    });

    console.log(`[Dungeon] Completed ${inst.instanceId} in ${duration}s — ${inst.killCount} kills, +${xpReward} XP`);
  }

  _failDungeon() {
    const inst = this._active;
    if (!inst) return;

    inst.state = 'failed';
    this._modMgr?.removeAll(inst.modifiers);

    this._eventBus?.emit('dungeon_failed', { instanceId: inst.instanceId });
    this._active = null;
    console.log(`[Dungeon] Failed: ${inst.instanceId}`);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  // Dungeon instances don't persist — only rewards do
  save() { return null; }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.group('[Dungeon]');
    console.log(`Active: ${this._active?.instanceId ?? 'none'}`);
    console.log(`Instances: ${this._instances.size}`);
    if (this._active) {
      const inst = this._active;
      console.log(`Room: ${inst.currentIndex + 1}/${inst.zones.length}`);
      console.log(`Kills: ${inst.killCount}  Difficulty: ${inst.difficulty}`);
      console.log(`Modifiers: ${inst.modifiers.map(m => m.id).join(', ') || 'none'}`);
    }
    console.groupEnd();
  }

  createTestDungeon() {
    return this.createInstance({ roomCount: 2, difficulty: 1 });
  }
}

function _defaultScaling(difficulty) {
  const t = difficulty;
  return {
    enemyHpMult:       1 + (t - 1) * 0.15,
    enemyDamageMult:   1 + (t - 1) * 0.10,
    enemyCountBonus:   Math.floor((t - 1) * 0.5),
    lootMultiplier:    1 + (t - 1) * 0.08,
    xpMultiplier:      1 + (t - 1) * 0.10,
  };
}
