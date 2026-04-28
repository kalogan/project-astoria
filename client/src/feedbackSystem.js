// Event-driven feedback system.
// Subscribes permanently to eventBus; triggers HUD effects and camera shake.
// All feedback is purely visual — never modifies game state.

import * as THREE from 'three';

const SHAKE_DURATION  = 0.28;
const SHAKE_MAGNITUDE = 0.07;

export class FeedbackSystem {
  constructor(hud, camera) {
    this._hud        = hud;
    this._camera     = camera;
    this._enabled    = true;
    this._unsubs     = [];

    // Camera shake: accumulated offset read by main.js each frame
    this.shakeOffset = new THREE.Vector3();
    this._shakeTimer  = 0;
    this._shakeOrigin = null; // camera position when shake started
  }

  // Wire permanent event subscriptions. Call once from main.js.
  subscribe(eventBus) {
    this._unsubs.forEach(u => u());
    this._unsubs = [
      eventBus.on('enemy_killed',       e => this._onEnemyKilled(e)),
      eventBus.on('loot_collected',     e => this._onLootCollected(e)),
      eventBus.on('level_up',           e => this._onLevelUp(e)),
      eventBus.on('quest_progress',     e => this._onQuestProgress(e)),
      eventBus.on('quest_complete',     e => this._onQuestComplete(e)),
      eventBus.on('zone_state_changed', e => this._onZoneStateChanged(e)),
      eventBus.on('zone_unlocked',      e => this._onZoneUnlocked(e)),
      eventBus.on('player_damaged',     e => this._onPlayerDamaged(e)),
    ];
  }

  // SystemManager interface — zone-scoped setup (currently unused).
  init(_zone, _registry, _eventBus) {}

  update(delta) {
    if (this._shakeTimer <= 0) return;
    this._shakeTimer = Math.max(0, this._shakeTimer - delta);
    if (this._shakeTimer === 0) {
      this.shakeOffset.set(0, 0, 0);
      return;
    }
    const t   = this._shakeTimer / SHAKE_DURATION;
    const mag = SHAKE_MAGNITUDE * t;
    // Math.random() is intentional here — shake is pure visual, not simulation state
    this.shakeOffset.set(
      (Math.random() - 0.5) * 2 * mag,
      0,
      (Math.random() - 0.5) * 2 * mag,
    );
  }

  onEvent(_event) {}

  setEnabled(on) {
    this._enabled = on;
    console.log(`[Feedback] ${on ? 'enabled' : 'disabled'}`);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  _onEnemyKilled({ payload }) {
    if (!this._enabled) return;
    if (payload.xpValue) {
      this._hud.spawnFloatingText(
        new THREE.Vector3(payload.x, 1.3, payload.z),
        `+${payload.xpValue} XP`,
        '#a0e0ff',
      );
    }
    this._shake();
  }

  _onLootCollected({ payload }) {
    if (!this._enabled) return;
    this._hud.spawnFloatingText(
      new THREE.Vector3(payload.x, 0.9, payload.z),
      'LOOT',
      '#ffd700',
    );
  }

  _onLevelUp({ payload }) {
    if (!this._enabled) return;
    this._hud.showBanner(`LEVEL ${payload.level}`, '#a0e0ff');
    this._hud.screenFlash('#a0e0ff', 0.20);
  }

  _onQuestProgress({ payload }) {
    if (!this._enabled || payload.complete) return;
    this._hud.showProgress(`${payload.progress} / ${payload.goal}`);
  }

  _onQuestComplete(_e) {
    if (!this._enabled) return;
    this._hud.showBanner('QUEST COMPLETE', '#2ecc71');
  }

  _onZoneStateChanged({ payload }) {
    if (!this._enabled) return;
    if (payload.state === 'cleared') {
      this._hud.showBanner('ZONE CLEARED', '#2ecc71');
      this._hud.screenFlash('#2ecc71', 0.12);
    } else if (payload.state === 'invaded') {
      this._hud.showBanner('ZONE INVADED', '#e74c3c');
      this._hud.screenFlash('#e74c3c', 0.18);
    }
  }

  _onZoneUnlocked({ payload }) {
    if (!this._enabled) return;
    this._hud.showProgress(`Unlocked: ${payload.zoneId}`);
  }

  _onPlayerDamaged({ payload }) {
    if (!this._enabled) return;
    this._hud.screenFlash('#e74c3c', 0.28);
    if (payload.hp <= 30) this._shake(); // extra feedback when low HP
  }

  // ── Camera shake ──────────────────────────────────────────────────────────

  _shake() {
    if (this._shakeTimer > 0) return; // don't stack
    this._shakeTimer = SHAKE_DURATION;
  }
}
