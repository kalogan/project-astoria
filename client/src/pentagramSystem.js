// pentagramSystem.js — ritual arena wave system.
// State machine: idle → activated → wave_1 → wave_2 → wave_3 → completed → cooldown
// Player interacts with pentagram entity to start; waves spawn via encounterSystem or direct.
// Emits: pentagram_started, pentagram_wave_started, pentagram_completed, pentagram_failed

import { Enemy } from './enemySystem.js';

const WAVE_DEFS = [
  { // Wave 1 — easy
    enemies: [
      { type: 'melee',  hp: 80,  speed: 2.5, attackDamage: 10, color: 0xff4400, xpValue: 10, count: 3 },
    ],
    delay: 1.0,
  },
  { // Wave 2 — medium
    enemies: [
      { type: 'melee',  hp: 80,  speed: 2.5, attackDamage: 10, color: 0xff4400, xpValue: 10, count: 3 },
      { type: 'ranged', hp: 60,  speed: 2.0, attackDamage: 12, color: 0xff8800, xpValue: 12, count: 2 },
    ],
    delay: 0.5,
  },
  { // Wave 3 — hard (mini-boss + guards)
    enemies: [
      { type: 'tank',   hp: 300, speed: 1.5, attackDamage: 20, color: 0x9b59b6, xpValue: 60, count: 1 },
      { type: 'melee',  hp: 80,  speed: 2.8, attackDamage: 12, color: 0xff4400, xpValue: 10, count: 2 },
    ],
    delay: 0.0,
  },
];

const REWARD = { xp: 120, gold: 80 };
const COOLDOWN_DURATION = 60; // seconds

export class PentagramSystem {
  constructor() {
    this._state        = 'idle';
    this._waveIndex    = 0;
    this._waveTimer    = 0;
    this._cooldown     = 0;
    this._waveEnemyIds = new Set();
    this._scene        = null;
    this._registry     = null;
    this._eventBus     = null;
    this._rng          = null;
    this._grid         = null;
    this._hud          = null;
    this._player       = null;
    this.enabled       = true;
  }

  setContext({ scene, player, hud }) {
    this._scene  = scene;
    this._player = player;
    this._hud    = hud;
  }

  init(zone, registry, eventBus, rng) {
    this._registry = registry;
    this._eventBus = eventBus;
    this._rng      = rng;
    this._grid     = zone.grid ?? null;
    this._state    = 'idle';
    this._cooldown = 0;

    this._unsub?.();
    this._unsub = eventBus.on('enemy_killed', ({ payload }) => {
      if (this._state.startsWith('wave')) this._onEnemyKilled(payload.enemyId);
    });

    // Listen for interact event on pentagram entity
    this._unsubActivate?.();
    this._unsubActivate = eventBus.on('entity_interact', ({ payload }) => {
      if (payload.entityType === 'pentagram') this.activate();
    });
  }

  onEvent() {}

  // Called by player interaction with pentagram entity
  activate() {
    if (!this.enabled) return;
    if (this._state === 'cooldown') {
      this._hud?.showBanner('Ritual on Cooldown', '#888888', 1500);
      return;
    }
    if (this._state !== 'idle') return;

    this._state     = 'activated';
    this._waveIndex = 0;
    this._waveTimer = 1.5; // brief pause before first wave
    this._waveEnemyIds.clear();

    this._eventBus?.emit('pentagram_started', {});
    this._hud?.showBanner('RITUAL BEGINS!', '#9b59b6', 2000);
    console.log('[Pentagram] Ritual started');
  }

  update(delta) {
    if (!this.enabled) return;

    if (this._state === 'cooldown') {
      this._cooldown -= delta;
      if (this._cooldown <= 0) {
        this._state = 'idle';
        console.log('[Pentagram] Cooldown expired — ready');
      }
      return;
    }

    if (this._state === 'activated') {
      this._waveTimer -= delta;
      if (this._waveTimer <= 0) this._startWave(0);
      return;
    }

    if (this._state.startsWith('wave')) {
      // Pending wave delay
      if (this._waveTimer > 0) {
        this._waveTimer -= delta;
        if (this._waveTimer <= 0) this._spawnCurrentWave();
      }
    }
  }

  _startWave(idx) {
    if (idx >= WAVE_DEFS.length) { this._complete(); return; }
    const waveDef   = WAVE_DEFS[idx];
    this._state     = `wave_${idx + 1}`;
    this._waveIndex = idx;
    this._waveTimer = waveDef.delay;
    this._waveEnemyIds.clear();

    this._eventBus?.emit('pentagram_wave_started', { wave: idx + 1, total: WAVE_DEFS.length });
    this._hud?.showBanner(`WAVE ${idx + 1}/${WAVE_DEFS.length}`, '#e74c3c', 1800);
    console.log(`[Pentagram] Wave ${idx + 1}`);

    if (waveDef.delay <= 0) this._spawnCurrentWave();
  }

  _spawnCurrentWave() {
    if (!this._scene || !this._grid) return;
    const waveDef = WAVE_DEFS[this._waveIndex];
    let seq = 0;
    const totalCount = waveDef.enemies.reduce((s, g) => s + g.count, 0);
    for (const group of waveDef.enemies) {
      for (let i = 0; i < group.count; i++) {
        const angle = (seq / totalCount) * Math.PI * 2;
        const dist  = 4 + (this._rng ? this._rng.nextFloat(0, 2) : 1);
        const id    = `pent_w${this._waveIndex}_${seq++}`;
        const enemy = new Enemy(this._scene, this._grid, {
          id,
          type:         group.type,
          x:            Math.cos(angle) * dist,
          z:            Math.sin(angle) * dist,
          hp:           group.hp,
          speed:        group.speed,
          attackDamage: group.attackDamage,
          color:        group.color,
          xpValue:      group.xpValue,
        });
        this._registry?.register('enemy', enemy);
        this._waveEnemyIds.add(id);
      }
    }
  }

  _onEnemyKilled(enemyId) {
    this._waveEnemyIds.delete(enemyId);
    if (this._waveEnemyIds.size === 0 && this._waveTimer <= 0) {
      // All wave enemies dead — advance
      const next = this._waveIndex + 1;
      if (next >= WAVE_DEFS.length) {
        this._complete();
      } else {
        this._startWave(next);
      }
    }
  }

  _complete() {
    this._state    = 'completed';
    this._cooldown = COOLDOWN_DURATION;

    this._eventBus?.emit('pentagram_completed', { reward: REWARD });
    this._hud?.showBanner('RITUAL COMPLETE!', '#f39c12', 3000);
    console.log('[Pentagram] Completed — reward:', REWARD);

    // Start cooldown after short celebration
    setTimeout(() => { this._state = 'cooldown'; }, 2000);
  }

  fail() {
    if (!this._state.startsWith('wave') && this._state !== 'activated') return;
    this._state = 'idle';
    this._eventBus?.emit('pentagram_failed', {});
    this._hud?.showBanner('RITUAL FAILED', '#e74c3c', 2500);
    // Clean up wave enemies
    for (const id of this._waveEnemyIds) {
      const e = this._registry?.getEntityById(id);
      if (e) { e.alive = false; e.mesh.visible = false; }
    }
    this._waveEnemyIds.clear();
    console.log('[Pentagram] Failed');
  }

  getState()  { return this._state; }
  isActive()  { return this._state !== 'idle' && this._state !== 'cooldown'; }

  inspect() {
    console.log(`[Pentagram] state=${this._state}  wave=${this._waveIndex}  enemies=${this._waveEnemyIds.size}  cooldown=${this._cooldown.toFixed(0)}s`);
  }

  forceComplete() { this._complete(); }
  skipToWave(n)   { this._startWave(Math.max(0, Math.min(n - 1, WAVE_DEFS.length - 1))); }

  toggle() {
    this.enabled = !this.enabled;
    console.log(`[Pentagram] enabled=${this.enabled}`);
  }
}
