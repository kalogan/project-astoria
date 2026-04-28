// Meta progression — persists across runs in a separate localStorage key.
// Tracks cumulative XP, gold, unlocked perks, and run history.
//
// Meta gold = floor(enemyXpValue * 0.5) per kill — deterministic.
// Meta level = 1 + floor(totalXP / 500) — one level per 500 cumulative XP.

const META_KEY     = 'astoria_meta';
const META_VERSION = 1;
const XP_PER_LEVEL = 500;

// Perk definitions. effect() mutates the multipliers object in-place.
export const PERK_DEFS = [
  { id: 'dmg1',  name: '+10% Damage',       cost:  150, metaLevel: 1,
    desc: 'All attacks deal 10% more damage.',
    effect: m => { m.damageMult += 0.10; } },
  { id: 'xp1',   name: '+20% XP Gain',       cost:  75,  metaLevel: 1,
    desc: 'Earn 20% more XP from enemies.',
    effect: m => { m.xpMult    += 0.20; } },
  { id: 'spd1',  name: '+5% Speed',           cost:  100, metaLevel: 1,
    desc: 'Player moves 5% faster.',
    effect: m => { m.speedMult += 0.05; } },
  { id: 'hp1',   name: '+10% Max HP',         cost:  150, metaLevel: 2,
    desc: 'Starting max HP increased by 10%.',
    effect: m => { m.hpMult    += 0.10; } },
  { id: 'loot1', name: '+15% Loot Chance',    cost:  125, metaLevel: 2,
    desc: 'Enemies drop loot 15% more often.',
    effect: m => { m.lootMult  += 0.15; } },
  { id: 'dmg2',  name: '+15% More Damage',    cost:  350, metaLevel: 3,
    desc: 'Further 15% damage increase.',
    effect: m => { m.damageMult += 0.15; } },
  { id: 'spd2',  name: '+10% More Speed',     cost:  250, metaLevel: 3,
    desc: 'Additional 10% movement speed.',
    effect: m => { m.speedMult += 0.10; } },
  { id: 'hp2',   name: '+20% More HP',        cost:  400, metaLevel: 4,
    desc: 'Additional 20% max HP.',
    effect: m => { m.hpMult    += 0.20; } },
  { id: 'crit1', name: '+5% Crit Chance',     cost:  200, metaLevel: 3,
    desc: 'All attacks have 5% more crit chance.',
    effect: m => { m.critMult  += 0.05; } },
  { id: 'xp2',   name: '+30% More XP',        cost:  300, metaLevel: 4,
    desc: 'Additional 30% XP from all sources.',
    effect: m => { m.xpMult    += 0.30; } },
];

const PERK_MAP = new Map(PERK_DEFS.map(p => [p.id, p]));

const BASE_MULTS = () => ({
  damageMult: 1,
  speedMult:  1,
  hpMult:     1,
  xpMult:     1,
  lootMult:   1,
  critMult:   0,  // additive bonus to crit chance
});

export class MetaProgressionManager {
  constructor() {
    this._totalXP       = 0;
    this._totalGold     = 0;
    this._metaLevel     = 1;
    this._unlockedPerks = new Set();
    this._runHistory    = [];
    this._currentRun    = _freshRun();
    this._eventBus      = null;
    this._mults         = BASE_MULTS();
  }

  // Wire event subscriptions. Call once from main.js.
  init(eventBus) {
    this._eventBus = eventBus;

    eventBus.on('enemy_killed', ({ payload }) => {
      const xp   = payload.xpValue ?? 10;
      const gold = Math.floor(xp * 0.5);
      this._totalXP   += xp;
      this._totalGold += gold;
      this._currentRun.kills++;
      this._currentRun.goldEarned += gold;
      this._checkMetaLevel();
    });

    eventBus.on('quest_complete', () => {
      this._totalXP   += 50;
      this._totalGold += 20;
      this._currentRun.questsCompleted++;
      this._checkMetaLevel();
    });

    eventBus.on('zone_completed', ({ payload }) => {
      this._currentRun.zonesCompleted.push(payload.zoneId);
    });
  }

  // ── Meta level ────────────────────────────────────────────────────────────

  getMetaLevel()  { return this._metaLevel; }
  getTotalXP()    { return this._totalXP; }
  getTotalGold()  { return this._totalGold; }

  _checkMetaLevel() {
    const newLevel = 1 + Math.floor(this._totalXP / XP_PER_LEVEL);
    if (newLevel <= this._metaLevel) return;
    const prev = this._metaLevel;
    this._metaLevel = newLevel;
    this._eventBus?.emit('meta_level_up', { metaLevel: newLevel, prev });
    console.log(`[Meta] Level ${prev} → ${newLevel}`);
  }

  // ── Perks ─────────────────────────────────────────────────────────────────

  getAvailablePerks() {
    return PERK_DEFS.filter(p =>
      !this._unlockedPerks.has(p.id) &&
      p.metaLevel <= this._metaLevel,
    );
  }

  getUnlockedPerks() {
    return [...this._unlockedPerks].map(id => PERK_MAP.get(id)).filter(Boolean);
  }

  canAfford(perkId) {
    const perk = PERK_MAP.get(perkId);
    return perk && this._totalGold >= perk.cost && perk.metaLevel <= this._metaLevel;
  }

  buyPerk(perkId) {
    const perk = PERK_MAP.get(perkId);
    if (!perk)                                  { console.warn(`[Meta] Unknown perk: ${perkId}`); return false; }
    if (this._unlockedPerks.has(perkId))        { console.warn(`[Meta] Already owned: ${perkId}`); return false; }
    if (this._totalGold < perk.cost)            { console.warn(`[Meta] Not enough gold (have ${this._totalGold}, need ${perk.cost})`); return false; }
    if (perk.metaLevel > this._metaLevel)       { console.warn(`[Meta] Meta level too low (need ${perk.metaLevel})`); return false; }

    this._totalGold -= perk.cost;
    this._unlockedPerks.add(perkId);
    this._rebuildMults();
    this._eventBus?.emit('perk_unlocked', { perkId, name: perk.name });
    console.log(`[Meta] Perk unlocked: "${perk.name}" (${this._totalGold} gold remaining)`);
    return true;
  }

  // Accumulated multipliers from all unlocked perks.
  getMultipliers() { return { ...this._mults }; }

  _rebuildMults() {
    this._mults = BASE_MULTS();
    for (const id of this._unlockedPerks) {
      PERK_MAP.get(id)?.effect(this._mults);
    }
  }

  // ── Run history ───────────────────────────────────────────────────────────

  endRun() {
    this._currentRun.endTime = Date.now();
    this._runHistory.push({ ...this._currentRun });
    if (this._runHistory.length > 20) this._runHistory.shift(); // keep last 20
    this._currentRun = _freshRun();
    this._save();
  }

  getCurrentRun() { return { ...this._currentRun }; }
  getRunHistory()  { return this._runHistory.slice(); }

  // ── Persistence ───────────────────────────────────────────────────────────

  _save() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify({
        version:        META_VERSION,
        totalXP:        this._totalXP,
        totalGold:      this._totalGold,
        metaLevel:      this._metaLevel,
        unlockedPerks:  [...this._unlockedPerks],
        runHistory:     this._runHistory,
      }));
    } catch (err) { console.warn('[Meta] save failed:', err); }
  }

  save() { this._save(); }

  load() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.version !== META_VERSION) return;
      this._totalXP       = data.totalXP       ?? 0;
      this._totalGold     = data.totalGold     ?? 0;
      this._metaLevel     = data.metaLevel     ?? 1;
      this._unlockedPerks = new Set(data.unlockedPerks ?? []);
      this._runHistory    = data.runHistory    ?? [];
      this._rebuildMults();
    } catch (err) { console.warn('[Meta] load failed:', err); }
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.group('[Meta] State');
    console.log(`Meta Level: ${this._metaLevel}  Total XP: ${this._totalXP}  Gold: ${this._totalGold}`);
    console.log('Unlocked perks:', [...this._unlockedPerks].join(', ') || '(none)');
    console.log('Current run:', this._currentRun);
    const m = this._mults;
    console.log(`Multipliers: dmg×${m.damageMult.toFixed(2)} spd×${m.speedMult.toFixed(2)} hp×${m.hpMult.toFixed(2)} xp×${m.xpMult.toFixed(2)}`);
    console.groupEnd();
  }

  addGold(n) {
    this._totalGold += n;
    console.log(`[Meta] Added ${n} gold (total: ${this._totalGold})`);
  }
}

function _freshRun() {
  return {
    startTime:       Date.now(),
    endTime:         null,
    kills:           0,
    questsCompleted: 0,
    zonesCompleted:  [],
    goldEarned:      0,
  };
}
