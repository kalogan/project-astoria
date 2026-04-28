// clanSpawnerSystem.js — clan jewel spawner with PvP-ready claim mechanics.
//
// State machine:  inactive → warming_up → active → claimable → cooldown
// Claim mechanic: player must stand in radius for CHANNEL_TIME seconds uninterrupted.
//                 If another player enters radius → contested → channel cancelled.
//                 Player takes damage → channel cancelled.
//
// Solo simulation: periodic enemy bursts provide pressure during "claimable" state.
//
// Emits: spawner_state_updated, spawner_claim_started, spawner_claim_interrupted,
//         spawner_claim_completed, clan_jewel_claimed

import * as THREE from 'three';
import { Enemy }  from './enemySystem.js';

const WARMUP_DURATION    = 15;   // seconds before spawner becomes active
const ACTIVE_DURATION    = 20;   // seconds spawner stays active before claimable
const CLAIMABLE_DURATION = 60;   // seconds player has to claim
const COOLDOWN_DURATION  = 90;   // seconds before cycle repeats
const CHANNEL_TIME       = 3;    // seconds to channel a claim
const CLAIM_RADIUS       = 3.5;  // world units
const PRESSURE_INTERVAL  = 18;   // seconds between pressure enemy bursts

let _spawnSeq = 0;

export class ClanSpawnerSystem {
  constructor() {
    this._state           = 'inactive';
    this._timer           = 0;
    this._claimantId      = null;   // playerId currently channeling
    this._channelTimer    = 0;
    this._pressureTimer   = 0;
    this._playersInRadius = new Set();  // future-proof: track multiple players
    this._spawnerPos      = null;   // THREE.Vector3 of the spawner entity
    this._scene           = null;
    this._registry        = null;
    this._eventBus        = null;
    this._rng             = null;
    this._grid            = null;
    this._player          = null;
    this._clanManager     = null;
    this._hud             = null;
    this._inventory       = null;
    this.enabled          = true;
  }

  setContext({ scene, player, hud, clanManager, inventory }) {
    this._scene       = scene;
    this._player      = player;
    this._hud         = hud;
    this._clanManager = clanManager;
    this._inventory   = inventory;
  }

  init(zone, registry, eventBus, rng) {
    this._registry = registry;
    this._eventBus = eventBus;
    this._rng      = rng;
    this._grid     = zone.grid ?? null;
    this._state    = 'inactive';
    this._timer    = 0;

    // Locate spawner entity position
    const spawnerEnt = registry.getEntitiesByType?.('clan_jewel_spawner')?.[0];
    if (spawnerEnt?.mesh) {
      this._spawnerPos = spawnerEnt.mesh.position.clone();
    } else {
      this._spawnerPos = new THREE.Vector3(0, 0, 8); // fallback from zone def
    }

    // Subscribe to damage — cancels channel
    this._unsub?.();
    this._unsub = eventBus.on('player_damaged', () => {
      if (this._claimantId !== null) this._interruptClaim('damage');
    });

    this._startWarmup();
  }

  onEvent() {}

  // ── State machine ──────────────────────────────────────────────────────────

  _startWarmup() {
    this._setState('warming_up');
    this._timer = WARMUP_DURATION;
    console.log('[Spawner] Warming up...');
  }

  _setState(newState) {
    const prev = this._state;
    this._state = newState;
    this._eventBus?.emit('spawner_state_updated', { state: newState, prev });
    this._hud?.showProgress(`Spawner: ${newState.replace('_', ' ').toUpperCase()}`);
  }

  update(delta) {
    if (!this.enabled) return;

    this._timer -= delta;

    switch (this._state) {
      case 'warming_up':
        if (this._timer <= 0) {
          this._setState('active');
          this._timer = ACTIVE_DURATION;
          this._hud?.showBanner('CLAN SPAWNER ACTIVE', '#f39c12', 2500);
        }
        break;

      case 'active':
        if (this._timer <= 0) {
          this._setState('claimable');
          this._timer = CLAIMABLE_DURATION;
          this._pressureTimer = PRESSURE_INTERVAL;
          this._hud?.showBanner('SPAWNER CLAIMABLE!', '#2ecc71', 3000);
          console.log('[Spawner] Now claimable');
        }
        break;

      case 'claimable':
        this._tickClaimable(delta);
        if (this._timer <= 0) {
          // Claimable window expired
          this._claimantId   = null;
          this._channelTimer = 0;
          this._setState('cooldown');
          this._timer = COOLDOWN_DURATION;
          console.log('[Spawner] Claimable window expired');
        }
        break;

      case 'cooldown':
        if (this._timer <= 0) this._startWarmup();
        break;
    }
  }

  _tickClaimable(delta) {
    if (!this._player || !this._spawnerPos) return;

    // Check if player is in radius
    const pp = this._player.mesh?.position;
    if (!pp) return;
    const dx    = pp.x - this._spawnerPos.x;
    const dz    = pp.z - this._spawnerPos.z;
    const inRad = (dx * dx + dz * dz) <= CLAIM_RADIUS * CLAIM_RADIUS;

    // Solo: treat as single player; mark in/out of radius
    if (inRad)  this._playersInRadius.add('local');
    else        this._playersInRadius.delete('local');

    const contested = this._playersInRadius.size > 1; // future multiplayer

    if (inRad && !contested) {
      // Eligible to claim
      if (this._claimantId === null) {
        this._claimantId   = 'local';
        this._channelTimer = CHANNEL_TIME;
        this._eventBus?.emit('spawner_claim_started', { playerId: 'local' });
        this._hud?.showBanner('Channeling Jewel...', '#f39c12', 3500);
        console.log('[Spawner] Channel started');
      }

      this._channelTimer -= delta;
      if (this._channelTimer <= 0) {
        this._completeClaim('local');
        return;
      }
    } else {
      // Left radius or contested
      if (this._claimantId !== null) {
        const reason = contested ? 'contested' : 'left_radius';
        this._interruptClaim(reason);
      }
    }

    // Pressure bursts
    this._pressureTimer -= delta;
    if (this._pressureTimer <= 0) {
      this._pressureTimer = PRESSURE_INTERVAL;
      this._spawnPressureBurst();
    }
  }

  _interruptClaim(reason) {
    if (this._claimantId === null) return;
    const pid = this._claimantId;
    this._claimantId   = null;
    this._channelTimer = 0;
    this._eventBus?.emit('spawner_claim_interrupted', { playerId: pid, reason });
    this._hud?.showBanner('Claim Interrupted!', '#e74c3c', 1800);
    console.log(`[Spawner] Claim interrupted: ${reason}`);
  }

  _completeClaim(playerId) {
    this._claimantId   = null;
    this._channelTimer = 0;
    this._setState('cooldown');
    this._timer = COOLDOWN_DURATION;

    // Grant jewel
    if (this._inventory) this._inventory.add?.({ id: 'clan_jewel', name: 'Clan Jewel', type: 'quest' });
    this._clanManager?.setCarryingJewel(playerId, true);

    this._eventBus?.emit('spawner_claim_completed', { playerId });
    this._eventBus?.emit('clan_jewel_claimed', { playerId });
    this._hud?.showBanner('JEWEL CLAIMED!', '#f39c12', 3500);
    console.log('[Spawner] Claim completed — jewel awarded');
  }

  _spawnPressureBurst() {
    if (!this._scene || !this._grid || !this._spawnerPos) return;
    const count = 2;
    for (let i = 0; i < count; i++) {
      const angle = (this._rng ? this._rng.nextFloat(0, Math.PI * 2) : i * Math.PI);
      const dist  = 5 + (this._rng ? this._rng.nextFloat(0, 2) : 1);
      const id    = `pressure_${++_spawnSeq}`;
      const enemy = new Enemy(this._scene, this._grid, {
        id,
        type: 'melee', x: this._spawnerPos.x + Math.cos(angle) * dist,
        z: this._spawnerPos.z + Math.sin(angle) * dist,
        hp: 80, speed: 2.2, attackDamage: 10, color: 0xd4c5a9, xpValue: 8,
      });
      this._registry?.register('enemy', enemy);
    }
    console.log('[Spawner] Pressure burst spawned');
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  getState()        { return this._state; }
  getChannelPct()   { return this._claimantId ? 1 - (this._channelTimer / CHANNEL_TIME) : 0; }
  forceClaimable()  { this._setState('claimable'); this._timer = CLAIMABLE_DURATION; this._pressureTimer = PRESSURE_INTERVAL; }
  forceCooldown()   { this._setState('cooldown'); this._timer = COOLDOWN_DURATION; }
  forceActive()     { this._setState('active'); this._timer = ACTIVE_DURATION; }

  inspect() {
    console.log(`[Spawner] state=${this._state} timer=${this._timer.toFixed(1)}s claimant=${this._claimantId ?? 'none'} channel=${this._channelTimer.toFixed(1)}s`);
  }
}
