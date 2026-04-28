// Encounter system — structured, intentional combat scenarios.
//
// Encounters define waves of enemies triggered by player proximity or events.
// Types: ambush | wave | boss | defense
//
// Integrates with aiSystem (forces aggro on spawn), eventBus (lifecycle events),
// and contentGenerator (generates encounter definitions per zone).

import { Enemy } from './enemySystem.js';

let _spawnSeq = 0;

// ── Encounter type metadata ───────────────────────────────────────────────────

const TYPE_BANNERS = {
  ambush:  { text: 'AMBUSH!',       color: '#e74c3c' },
  wave:    { text: 'WAVE INCOMING!', color: '#f39c12' },
  boss:    { text: 'BOSS!',          color: '#9b59b6' },
  defense: { text: 'DEFEND!',        color: '#e67e22' },
};

// ── EncounterSystem ───────────────────────────────────────────────────────────

export class EncounterSystem {
  constructor() {
    this._encounters  = [];       // EncounterDef[] loaded from zone
    this._active      = new Map(); // id → RunState
    this._scene       = null;
    this._player      = null;
    this._registry    = null;
    this._eventBus    = null;
    this._grid        = null;
    this._gridOffset  = 0;
    this._hud         = null;
    this._aiSystem    = null;
    this._checkTimer  = 0;
    this.enabled      = true;
  }

  // Set once from main.js — stable references that survive zone loads
  setContext({ scene, player, hud = null, aiSystem = null }) {
    this._scene     = scene;
    this._player    = player;
    this._hud       = hud;
    this._aiSystem  = aiSystem;
  }

  // Called per zone load by systemManager
  init(zone, registry, eventBus, rng = null) {
    this._registry   = registry;
    this._eventBus   = eventBus;
    this._rng        = rng;
    this._active.clear();
    this._checkTimer = 0;

    // Derive grid + offset from zone data if present
    this._grid       = zone.grid       ?? null;
    this._gridOffset = zone.gridOffset ?? 0;

    // Load encounter defs from zone
    this._encounters = zone.encounters ?? [];

    this._unsub?.();
    this._unsub = eventBus.on('enemy_killed', ({ payload }) => {
      this._onEnemyKilled(payload.enemyId);
    });
  }

  onEvent() {}

  // Inject encounter definitions after init (used by contentGenerator)
  loadEncounters(defs) {
    this._encounters = [...(this._encounters ?? []), ...defs];
  }

  // ── Update ────────────────────────────────────────────────────────────────

  update(delta) {
    if (!this.enabled) return;

    // Throttle area-trigger checks
    this._checkTimer -= delta;
    if (this._checkTimer <= 0) {
      this._checkTimer = 0.3;
      this._checkAreaTriggers();
    }

    // Tick active encounters
    for (const [id, run] of this._active) {
      this._tickRun(id, run, delta);
    }
  }

  // ── Manual trigger (for debug / event-based triggers) ────────────────────

  trigger(encounterId) {
    const def = this._encounters.find(e => e.id === encounterId);
    if (!def) { console.warn(`[Encounter] Unknown: "${encounterId}"`); return false; }
    if (this._active.has(def.id)) { console.warn(`[Encounter] Already running: "${encounterId}"`); return false; }
    this._startEncounter(def);
    return true;
  }

  // ── Area-trigger check ────────────────────────────────────────────────────

  _checkAreaTriggers() {
    if (!this._player) return;
    const pp = this._player.mesh.position;

    for (const def of this._encounters) {
      if (this._active.has(def.id)) continue;
      if (def.trigger?.type !== 'area') continue;

      const tp     = def.trigger.position ?? { x: 0, z: 0 };
      const radius = def.trigger.radius ?? 3;
      const dx = pp.x - tp.x, dz = pp.z - tp.z;
      if (dx * dx + dz * dz <= radius * radius) {
        this._startEncounter(def);
      }
    }
  }

  // ── Encounter lifecycle ───────────────────────────────────────────────────

  _startEncounter(def) {
    const run = {
      def,
      waveIndex:        0,
      totalKills:       0,
      waveEnemyIds:     new Set(),
      waveSpawnTimer:   0,
      pendingWave:      null,
      defenseTimer:     def.type === 'defense' ? (def.defenseSeconds ?? 30) : 0,
      failed:           false,
    };
    this._active.set(def.id, run);

    const banner = TYPE_BANNERS[def.type] ?? TYPE_BANNERS.wave;
    this._hud?.showBanner(banner.text, banner.color, 2000);
    this._eventBus?.emit('encounter_started', { id: def.id, type: def.type });
    console.log(`[Encounter] Started "${def.id}" (${def.type})`);

    this._beginWave(run, 0);
  }

  _beginWave(run, waveIdx) {
    const waves = run.def.waves ?? [];
    if (waveIdx >= waves.length) return;

    const wave = waves[waveIdx];
    run.waveIndex     = waveIdx;
    run.waveEnemyIds  = new Set();

    this._eventBus?.emit('encounter_wave_started', {
      id:        run.def.id,
      waveIndex: waveIdx,
      total:     waves.length,
    });
    console.log(`[Encounter] Wave ${waveIdx + 1}/${waves.length}`);

    const delay = wave.delay ?? 0;
    if (delay > 0) {
      run.waveSpawnTimer = delay;
      run.pendingWave    = wave;
    } else {
      this._spawnWave(run, wave);
    }
  }

  _spawnWave(run, wave) {
    if (!this._scene || !this._grid?.length) return;

    const tp  = run.def.trigger?.position ?? { x: 0, z: 0 };
    const rng = this._rng;

    for (const group of wave.enemies ?? []) {
      const count = group.count ?? 1;
      for (let i = 0; i < count; i++) {
        const angle  = rng ? rng.nextFloat(0, Math.PI * 2) : Math.random() * Math.PI * 2;
        const dist   = rng ? rng.nextFloat(1.5, 3.5) : 1.5 + Math.random() * 2;
        const spawnX = tp.x + Math.cos(angle) * dist;
        const spawnZ = tp.z + Math.sin(angle) * dist;

        const def = {
          id:           `enc_${run.def.id}_w${run.waveIndex}_${++_spawnSeq}`,
          type:         group.type        ?? 'melee',
          x:            spawnX,
          z:            spawnZ,
          hp:           group.hp          ?? undefined,
          speed:        group.speed       ?? undefined,
          attackDamage: group.attackDamage ?? undefined,
          xpValue:      group.xpValue     ?? 12,
          color:        group.color       ?? undefined,
        };

        const enemy = new Enemy(this._scene, this._grid, def);
        this._registry?.register('enemy', enemy);
        this._hud?.initEnemyLabels([enemy]);

        // Force AI into aggro immediately
        if (this._aiSystem) {
          this._aiSystem.forceAggro(enemy);
        }

        run.waveEnemyIds.add(def.id);
      }
    }
  }

  // ── Per-frame tick ────────────────────────────────────────────────────────

  _tickRun(id, run, delta) {
    // Deferred wave spawn
    if (run.pendingWave && run.waveSpawnTimer > 0) {
      run.waveSpawnTimer -= delta;
      if (run.waveSpawnTimer <= 0) {
        this._spawnWave(run, run.pendingWave);
        run.pendingWave = null;
      }
    }

    // Defense countdown
    if (run.def.type === 'defense' && run.defenseTimer > 0) {
      run.defenseTimer -= delta;
      if (run.defenseTimer <= 0) {
        this._completeEncounter(id, run);
      }
    }
  }

  // ── Kill tracking ─────────────────────────────────────────────────────────

  _onEnemyKilled(enemyId) {
    for (const [encId, run] of this._active) {
      if (!run.waveEnemyIds.has(enemyId)) continue;
      run.waveEnemyIds.delete(enemyId);
      run.totalKills++;

      // Check completion condition
      const completeOn = run.def.conditions?.completeOn ?? 'all_enemies_dead';
      if (completeOn === 'all_enemies_dead' && run.waveEnemyIds.size === 0) {
        const nextWave = run.waveIndex + 1;
        const waveCount = run.def.waves?.length ?? 0;
        if (nextWave < waveCount) {
          this._beginWave(run, nextWave);
        } else {
          this._completeEncounter(encId, run);
        }
      }
      break;
    }
  }

  // ── Completion ────────────────────────────────────────────────────────────

  _completeEncounter(id, run) {
    this._active.delete(id);

    const xpReward   = (run.def.reward?.xp   ?? 25) + run.totalKills * 5;
    const goldReward = (run.def.reward?.gold  ?? 15);

    this._hud?.showBanner('ENCOUNTER COMPLETE', '#2ecc71', 2200);
    this._eventBus?.emit('encounter_completed', {
      id, xpReward, goldReward, kills: run.totalKills,
    });
    console.log(`[Encounter] Completed "${id}" — ${run.totalKills} kills, +${xpReward} XP`);
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.group('[Encounter]');
    console.log(`Defined: ${this._encounters.length}  Active: ${this._active.size}`);
    for (const [id, run] of this._active) {
      console.log(`  ${id}: wave ${run.waveIndex + 1}, enemies left: ${run.waveEnemyIds.size}, type: ${run.def.type}`);
    }
    console.groupEnd();
  }

  listAll() {
    return this._encounters.map(e => ({ id: e.id, type: e.type, active: this._active.has(e.id) }));
  }
}
