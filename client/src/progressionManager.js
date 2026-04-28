// Cross-zone progression manager.
// Tracks player level, XP, unlocked zones, global flags, and key items.
//
// Zone locking is opt-in: unlocked.size === 0 → all zones accessible.
// Use lockZone(id) to restrict access; unlock(id) to open it.

const XP_BASE    = 100;   // XP needed for level 2
const XP_FACTOR  = 1.5;   // exponent in XP curve: xpToNext = XP_BASE * level^XP_FACTOR
const MAX_LEVEL  = 50;
const HP_PER_LVL = 0.05;  // +5% max HP per level above 1
const ATK_PER_LVL = 0.05; // +5% attack per level above 1

function _xpForLevel(level) {
  return Math.round(XP_BASE * Math.pow(level, XP_FACTOR));
}

export class ProgressionManager {
  constructor() {
    this._level     = 1;
    this._xp        = 0;
    this._xpToNext  = _xpForLevel(1);
    this._unlocked  = new Set();  // explicitly unlocked zone ids
    this._locked    = new Set();  // explicitly locked zone ids
    this._completed = new Set();  // zones whose quests / objectives are done
    this._flags     = new Set();  // global gameplay flags
    this._keyItems  = [];
    this._eventBus  = null;
  }

  // Wire the event bus. Call once from main.js.
  init(eventBus) {
    this._eventBus = eventBus;
  }

  // ── Zone access ───────────────────────────────────────────────────────────

  // Mark zones accessible at startup (typically ['Cameron_Start']).
  setStartingZones(ids) {
    for (const id of ids) this._unlocked.add(id);
  }

  unlock(zoneId) {
    this._locked.delete(zoneId);
    if (this._unlocked.has(zoneId)) return;
    this._unlocked.add(zoneId);
    this._eventBus?.emit('zone_unlocked', { zoneId });
    console.log(`[Progression] Unlocked: "${zoneId}"`);
  }

  lockZone(zoneId) {
    this._unlocked.delete(zoneId);
    this._locked.add(zoneId);
    console.log(`[Progression] Locked: "${zoneId}"`);
  }

  // Returns false only when the zone is explicitly locked.
  // If no zones have ever been locked, all zones are accessible.
  canEnter(zoneId) {
    if (this._locked.has(zoneId)) return false;
    // If an unlock list exists and this zone is not in it, block entry.
    if (this._unlocked.size > 0 && !this._unlocked.has(zoneId)) return false;
    return true;
  }

  isUnlocked(zoneId) { return this._unlocked.has(zoneId); }

  completeZone(zoneId) {
    if (this._completed.has(zoneId)) return;
    this._completed.add(zoneId);
    this._eventBus?.emit('zone_completed', { zoneId });
    console.log(`[Progression] Zone completed: "${zoneId}"`);
  }

  isCompleted(zoneId) { return this._completed.has(zoneId); }

  // ── XP + levels ───────────────────────────────────────────────────────────

  addXP(amount) {
    if (this._level >= MAX_LEVEL) return;
    this._xp += Math.floor(amount);
    while (this._xp >= this._xpToNext && this._level < MAX_LEVEL) {
      this._xp      -= this._xpToNext;
      this._level++;
      this._xpToNext = _xpForLevel(this._level);
      this._eventBus?.emit('level_up', {
        level:       this._level,
        attackBonus: this.getAttackBonus(),
        hpBonus:     this.getHPBonus(),
      });
      console.log(`[Progression] Level up → ${this._level} (next: ${this._xpToNext} XP)`);
    }
  }

  getLevel()       { return this._level; }
  getXP()          { return this._xp; }
  getXPToNext()    { return this._xpToNext; }

  // Fractional bonus multipliers (0.0 at level 1, +0.05 per level).
  // ⚠ DEPRECATED — level-based stat growth is now handled exclusively by
  //   BuildManager.onLevelUp() via CLASS_DEFS[id].statGrowth.  These methods
  //   are kept for legacy event payloads and should not be used for new combat math.
  getAttackBonus() { return (this._level - 1) * ATK_PER_LVL; }
  getHPBonus()     { return (this._level - 1) * HP_PER_LVL; }

  // ── Flags + key items ─────────────────────────────────────────────────────

  addFlag(flag)      { this._flags.add(flag); }
  hasFlag(flag)      { return this._flags.has(flag); }
  removeFlag(flag)   { this._flags.delete(flag); }

  addKeyItem(item)   { if (!this._keyItems.includes(item)) this._keyItems.push(item); }
  hasKeyItem(item)   { return this._keyItems.includes(item); }
  removeKeyItem(item) {
    const i = this._keyItems.indexOf(item);
    if (i !== -1) this._keyItems.splice(i, 1);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save() {
    return {
      level:     this._level,
      xp:        this._xp,
      xpToNext:  this._xpToNext,
      unlocked:  [...this._unlocked],
      locked:    [...this._locked],
      completed: [...this._completed],
      flags:     [...this._flags],
      keyItems:  this._keyItems.slice(),
    };
  }

  load(data) {
    if (!data) return;
    this._level     = data.level     ?? 1;
    this._xp        = data.xp        ?? 0;
    this._xpToNext  = data.xpToNext  ?? _xpForLevel(this._level);
    this._unlocked  = new Set(data.unlocked  ?? []);
    this._locked    = new Set(data.locked    ?? []);
    this._completed = new Set(data.completed ?? []);
    this._flags     = new Set(data.flags     ?? []);
    this._keyItems  = data.keyItems ?? [];
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.group('[Progression] State');
    console.log(`Level: ${this._level}  XP: ${this._xp}/${this._xpToNext}`);
    console.log(`Attack bonus: +${(this.getAttackBonus() * 100).toFixed(0)}%  HP bonus: +${(this.getHPBonus() * 100).toFixed(0)}%`);
    console.log('Unlocked zones:', [...this._unlocked].join(', ') || '(none — all accessible)');
    console.log('Completed zones:', [...this._completed].join(', ') || '(none)');
    console.log('Flags:', [...this._flags].join(', ') || '(none)');
    console.log('Key items:', this._keyItems.join(', ') || '(none)');
    console.groupEnd();
  }

  unlockAll(ids) {
    for (const id of ids) this.unlock(id);
  }
}
