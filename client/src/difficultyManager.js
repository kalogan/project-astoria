// Difficulty manager — tracks tier and scales dungeons for an endless loop.
//
// Tier increases after each completed dungeon. Stats scale gradually:
//   enemy HP  +15% / tier, enemy damage +10% / tier, modifiers increase.
//
// Persisted separately in localStorage (astoria_difficulty).

const STORAGE_KEY = 'astoria_difficulty';
const MAX_TIER    = 99;
const XP_SCALE    = 0.10;   // +10% XP per tier above 1
const LOOT_SCALE  = 0.08;   // +8%  loot multiplier per tier

export class DifficultyManager {
  constructor() {
    this._tier    = 1;
    this._best    = 1;
    this._eventBus = null;
  }

  init(eventBus) {
    this._eventBus = eventBus;

    eventBus.on('dungeon_completed', () => this.increaseTier());
    // Optional penalty on failure — uncomment to enable
    // eventBus.on('dungeon_failed', () => this._onFail());
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getTier()     { return this._tier; }
  getBestTier() { return this._best; }

  getScaling() {
    const t = this._tier;
    return {
      tier:              t,
      enemyHpMult:       1 + (t - 1) * 0.15,
      enemyDamageMult:   1 + (t - 1) * 0.10,
      enemyCountBonus:   Math.floor((t - 1) * 0.50),
      lootMultiplier:    1 + (t - 1) * LOOT_SCALE,
      xpMultiplier:      1 + (t - 1) * XP_SCALE,
      modifierCount:     Math.min(3, 1 + Math.floor((t - 1) / 3)),
    };
  }

  // Scale a single enemy definition — call before spawning in a dungeon
  applyToEnemy(def) {
    const s = this.getScaling();
    return {
      ...def,
      hp:           Math.floor((def.hp           ?? 80)  * s.enemyHpMult),
      attackDamage: Math.floor((def.attackDamage ?? 10)  * s.enemyDamageMult),
    };
  }

  // ── Tier management ───────────────────────────────────────────────────────

  increaseTier() {
    if (this._tier >= MAX_TIER) return;
    const prev    = this._tier;
    this._tier++;
    if (this._tier > this._best) this._best = this._tier;
    this._save();
    this._eventBus?.emit('difficulty_increased', { tier: this._tier, prev });
    console.log(`[Difficulty] Tier ${prev} → ${this._tier}`);
  }

  setTier(t) {
    this._tier = Math.max(1, Math.min(MAX_TIER, Math.floor(t)));
    if (this._tier > this._best) this._best = this._tier;
    this._save();
    console.log(`[Difficulty] Tier forced to ${this._tier}`);
  }

  reset() {
    this._tier = 1;
    this._save();
    console.log('[Difficulty] Reset to tier 1');
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save() { this._save(); }

  load() {
    try {
      const raw  = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this._tier = data.tier ?? 1;
      this._best = data.best ?? this._tier;
    } catch { /* ignore */ }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tier: this._tier,
        best: this._best,
      }));
    } catch { /* ignore */ }
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    const s = this.getScaling();
    console.group(`[Difficulty] Tier ${this._tier}  (best: ${this._best})`);
    console.log(`Enemy HP:    ×${s.enemyHpMult.toFixed(2)}`);
    console.log(`Enemy DMG:   ×${s.enemyDamageMult.toFixed(2)}`);
    console.log(`Extra enemies: +${s.enemyCountBonus}`);
    console.log(`Loot mult:   ×${s.lootMultiplier.toFixed(2)}`);
    console.log(`XP mult:     ×${s.xpMultiplier.toFixed(2)}`);
    console.log(`Modifier slots: ${s.modifierCount}`);
    console.groupEnd();
  }
}
