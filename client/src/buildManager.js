// buildManager.js — single source of truth for class, stats, skills, and derived multipliers.
//
// ── ARCHITECTURE ──────────────────────────────────────────────────────────────
//
// THREE separate "leveling" systems co-exist:
//
//   1. BASE STATS (STR / AGI / INT / VIT / WIS)
//      Allocated with `_unspentPoints` via applyStatPoint().
//      5 points granted per level-up.
//
//   2. ASTONIA CLASS SKILLS (sword, attack, armorSkill, lightning, fire …)
//      Allocated with `_unspentSkillPoints` via applySkillPoint().
//      3 points granted per level-up.
//      Computed value = rawLevel × statMult (so stats and skills multiply).
//      Used as INPUT to all damage / speed / defense formulas.
//
//   3. ABILITY LEVELS (fireball Lv1–10, lightning_ball Lv1–10 …)
//      Allocated via addSkillLevel() – currently tied to skill-tree system.
//      Used as a flat multiplier inside abilitySystem for e.g. +10% per level.
//
// ── COMBAT FORMULA SUMMARY ────────────────────────────────────────────────────
//   Warrior auto:    getWeaponDamage()  = (sword + attack + tactics) × STR × classMult
//   Mage spell:      getSpellDamage(sk) = computedSkill(sk) × scalar × abilityMult
//   Attack speed:    getAttackSpeed()   = 0.5 / (1 + speed×0.004 + speedSkill×0.003)
//   Armor:           getArmorReduction()= computedSkill(armorSkill) × 0.008  (max 60%)
//   HP regen:        getHpRegen()       = computedSkill(regenerate) × 0.05 HP/s
//   Surround radius: getSurroundRadius()= 2.0 + computedSkill(surroundHit)×0.04
//   Magic Shield:    getMagicShieldStats()
//   Mana regen:      getManaRegenTotal() = WIS×1.2 + computedMeditate×0.15
//
// ── STAT EFFECTS (unchanged from before) ─────────────────────────────────────
//   strength     → +2% physical damage per point
//   agility      → +1.5% speed, +0.3% crit chance per point
//   intelligence → +2.5% ability damage per point  +10 mana per point
//   vitality     → +3% max HP per point
//   wisdom       → +0.8% CDR per point  +4 mana per point  +1.2 mana/s regen

const BASE_HP     = 100;
const BASE_DAMAGE = 34;   // retained for fallback only

export const STAT_LABELS = {
  strength:     'STR',
  agility:      'AGI',
  intelligence: 'INT',
  vitality:     'VIT',
  wisdom:       'WIS',
};

export const STAT_DESCS = {
  strength:     '+2% melee damage per point',
  agility:      '+1.5% speed · +0.3% crit per point',
  intelligence: '+2.5% ability damage per point',
  vitality:     '+3% max HP per point',
  wisdom:       '+0.8% CDR per point',
};

export const STAT_POINTS_PER_LEVEL  = 5;
export const SKILL_POINTS_PER_LEVEL = 3;

// ── Astonia-style class skill table ───────────────────────────────────────────
//
// Each entry: { label, stats: { statName: weight }, base }
//   base  = raw trained level at class start (before any point investment)
//   stats = which player attributes boost this skill, and how much
//
// computedSkill(id) = rawLevel × (1 + Σ statVal × weight × 0.02)
//
// This makes both training AND stat investment meaningful.
// A warrior with STR 20 gets more out of every sword skill point than one at STR 8.

export const CLASS_SKILLS = {

  // ────────────── WARRIOR ──────────────────────────────────────────────────
  warrior: {
    attack:      { label: 'Attack',       stats: { strength: 0.8, agility: 0.2 },              base: 5 },
    speed:       { label: 'Speed',        stats: { agility: 1.0 },                              base: 5 },
    speedSkill:  { label: 'Speed Skill',  stats: { agility: 0.7, strength: 0.3 },              base: 3 },
    tactics:     { label: 'Tactics',      stats: { strength: 0.4, agility: 0.3, wisdom: 0.3 }, base: 3 },
    sword:       { label: 'Sword',        stats: { strength: 0.7, agility: 0.3 },              base: 6 },
    twoHanded:   { label: 'Two-Handed',   stats: { strength: 1.0 },                             base: 3 },
    armorSkill:  { label: 'Armor',        stats: { vitality: 0.8, strength: 0.2 },             base: 5 },
    parrySkill:  { label: 'Parry',        stats: { agility: 0.6, strength: 0.4 },              base: 3 },
    warcry:      { label: 'Warcry',       stats: { strength: 0.7, vitality: 0.3 },             base: 3 },
    surroundHit: { label: 'Surround Hit', stats: { strength: 0.6, agility: 0.4 },              base: 3 },
    bodyControl: { label: 'Body Control', stats: { vitality: 0.7, wisdom: 0.3 },               base: 3 },
    regenerate:  { label: 'Regenerate',   stats: { vitality: 0.6, wisdom: 0.4 },               base: 3 },
    immunity:    { label: 'Immunity',     stats: { vitality: 0.5, wisdom: 0.5 },               base: 2 },
    rage:        { label: 'Rage',         stats: { strength: 0.9, vitality: 0.1 },             base: 2 },
  },

  // ────────────── ROGUE ────────────────────────────────────────────────────
  rogue: {
    attack:      { label: 'Attack',       stats: { strength: 0.5, agility: 0.5 },              base: 5 },
    speed:       { label: 'Speed',        stats: { agility: 1.0 },                              base: 7 },
    dagger:      { label: 'Dagger',       stats: { agility: 0.7, strength: 0.3 },              base: 7 },
    backstab:    { label: 'Backstab',     stats: { agility: 0.6, strength: 0.4 },              base: 5 },
    stealth:     { label: 'Stealth',      stats: { agility: 0.8, intelligence: 0.2 },          base: 5 },
    parrySkill:  { label: 'Parry',        stats: { agility: 0.7, strength: 0.3 },              base: 3 },
    perception:  { label: 'Perception',   stats: { agility: 0.5, intelligence: 0.5 },          base: 3 },
    regenerate:  { label: 'Regenerate',   stats: { vitality: 0.6, wisdom: 0.4 },               base: 3 },
  },

  // ────────────── MAGE ─────────────────────────────────────────────────────
  mage: {
    dagger:      { label: 'Dagger',       stats: { agility: 0.7, strength: 0.3 },              base: 3 },
    handToHand:  { label: 'Hand-to-Hand', stats: { strength: 0.6, agility: 0.4 },              base: 2 },
    staff:       { label: 'Staff',        stats: { intelligence: 0.5, wisdom: 0.5 },           base: 5 },
    bless:       { label: 'Bless',        stats: { wisdom: 0.8, intelligence: 0.2 },           base: 3 },
    heal:        { label: 'Heal',         stats: { wisdom: 0.7, intelligence: 0.3 },           base: 3 },
    freeze:      { label: 'Freeze',       stats: { intelligence: 0.6, wisdom: 0.4 },           base: 3 },
    magicShield: { label: 'Magic Shield', stats: { intelligence: 0.5, wisdom: 0.5 },           base: 5 },
    lightning:   { label: 'Lightning',    stats: { intelligence: 0.7, wisdom: 0.3 },           base: 5 },
    fire:        { label: 'Fire',         stats: { intelligence: 0.7, wisdom: 0.3 },           base: 5 },
    pulse:       { label: 'Pulse',        stats: { intelligence: 0.5, wisdom: 0.5 },           base: 5 },
    bartering:   { label: 'Bartering',    stats: { wisdom: 0.6, intelligence: 0.4 },           base: 2 },
    perception:  { label: 'Perception',   stats: { agility: 0.5, intelligence: 0.5 },          base: 3 },
    stealth:     { label: 'Stealth',      stats: { agility: 0.8, intelligence: 0.2 },          base: 2 },
    meditate:    { label: 'Meditate',     stats: { wisdom: 1.0 },                              base: 5 },
    immunity:    { label: 'Immunity',     stats: { vitality: 0.5, wisdom: 0.5 },               base: 2 },
    duration:    { label: 'Duration',     stats: { wisdom: 0.6, intelligence: 0.4 },           base: 3 },
  },
};

export const CLASS_DEFS = {
  warrior: {
    name:       'Warrior',
    color:      '#e74c3c',
    baseStats:  { strength: 8, agility: 4, intelligence: 2, vitality: 10, wisdom: 3 },
    statGrowth: { strength: 2, agility: 1, intelligence: 0, vitality: 2,  wisdom: 1 },
    mults:      { damage: 1.15, abilityDamage: 1.00, speed: 1.00, hp: 1.20, crit: 0.50 },
    desc:       'High HP and melee damage. Skill-driven combat.',
    flavour:    'STR · VIT focused',
  },
  rogue: {
    name:       'Rogue',
    color:      '#2ecc71',
    baseStats:  { strength: 5, agility: 10, intelligence: 3, vitality: 6, wisdom: 2 },
    statGrowth: { strength: 1, agility: 2,  intelligence: 1, vitality: 1, wisdom: 0 },
    mults:      { damage: 1.00, abilityDamage: 1.10, speed: 1.20, hp: 0.85, crit: 1.15 },
    desc:       'Fast and precise. High crit chance, lower durability.',
    flavour:    'AGI · STR focused',
  },
  mage: {
    name:       'Mage',
    color:      '#3498db',
    baseStats:  { strength: 3, agility: 4,  intelligence: 10, vitality: 5, wisdom: 8 },
    statGrowth: { strength: 0, agility: 1,  intelligence: 3,  vitality: 1, wisdom: 2 },
    mults:      { damage: 0.65, abilityDamage: 1.40, speed: 0.95, hp: 0.90, crit: 0.50 },
    desc:       'High burst spell damage. Fragile, mana-dependent.',
    flavour:    'INT · WIS focused',
  },
};

export const CLASS_IDS = Object.keys(CLASS_DEFS);

// ── BuildManager ──────────────────────────────────────────────────────────────

export class BuildManager {
  constructor() {
    this._classId            = 'warrior';
    this._level              = 1;
    this._stats              = { strength: 0, agility: 0, intelligence: 0, vitality: 0, wisdom: 0 };
    this._passives           = _emptyPassives();
    this._meta               = { damageMult: 1, speedMult: 1, hpMult: 1, xpMult: 1, lootMult: 1, critMult: 0 };
    this._eventBus           = null;
    this._unspentPoints      = 0;   // stat allocation points
    this._unspentSkillPoints = 0;   // Astonia skill training points
    this._mana               = 0;
    // Ability upgrade levels (fireball Lv1–10, etc.)
    this._skillLevels        = {};
    // Astonia class skills: raw trained levels
    this._classSkills        = {};

    this.setClass('warrior');
  }

  init(eventBus) { this._eventBus = eventBus; }

  // ── Class ─────────────────────────────────────────────────────────────────

  setClass(classId) {
    if (!CLASS_DEFS[classId]) {
      console.warn(`[Build] Unknown class: "${classId}"`);
      return;
    }
    this._classId = classId;
    this._stats   = { ...CLASS_DEFS[classId].baseStats };
    this._mana    = this.getManaPool();
    // Initialise ability-upgrade levels for class kit (all Lv1)
    const kitMap = {
      warrior: ['surround_hit', 'warcry', 'parry'],
      rogue:   ['backstab', 'dash'],
      mage:    ['fireball', 'lightning_ball', 'lightning_bolt', 'lightning_pulse', 'magic_shield'],
    };
    this.initSkills(kitMap[classId] ?? []);
    // Initialise Astonia class skills at base values
    this._initClassSkills(classId);
    this._eventBus?.emit('stat_changed', { classId, stats: this.getStats() });
    console.log(`[Build] Class: ${CLASS_DEFS[classId].name}`);
  }

  getClass()    { return this._classId; }
  getClassDef() { return CLASS_DEFS[this._classId]; }

  // ── Base stats ────────────────────────────────────────────────────────────

  onLevelUp(level) {
    this._level = level;
    const growth = CLASS_DEFS[this._classId].statGrowth;
    for (const [stat, gain] of Object.entries(growth)) {
      this._stats[stat] = (this._stats[stat] ?? 0) + gain;
    }
    this._eventBus?.emit('stat_changed', { level, stats: this.getStats() });
  }

  getStats() { return { ...this._stats }; }

  // ── Stat point allocation ─────────────────────────────────────────────────

  grantStatPoints(n = STAT_POINTS_PER_LEVEL) {
    this._unspentPoints += n;
    this._eventBus?.emit('stat_points_granted', { unspent: this._unspentPoints });
  }

  getUnspentPoints() { return this._unspentPoints; }

  applyStatPoint(stat) {
    if (this._unspentPoints <= 0) { console.warn('[Build] No unspent stat points'); return false; }
    if (!(stat in this._stats))   { console.warn(`[Build] Unknown stat: "${stat}"`); return false; }
    this._unspentPoints--;
    this._stats[stat]++;
    this._eventBus?.emit('stat_changed', {
      stat, value: this._stats[stat], unspent: this._unspentPoints, stats: this.getStats(),
    });
    console.log(`[Build] +1 ${stat} → ${this._stats[stat]}  (${this._unspentPoints} pts left)`);
    return true;
  }

  // ── Passive bonuses (from skill tree) ─────────────────────────────────────

  addPassive(effect) {
    const map = {
      damage:         'damageBonus',
      hp:             'hpBonus',
      speed:          'speedBonus',
      crit:           'critBonus',
      ability_damage: 'abilityDmgBonus',
      crit_mult:      'critMultBonus',
      cdr:            'cooldownReduction',
      defense:        'defenseBonus',
    };
    const key = map[effect.type];
    if (key) this._passives[key] += effect.value ?? 0;
  }

  resetPassives() { this._passives = _emptyPassives(); }

  // ── Meta multipliers ──────────────────────────────────────────────────────

  setMetaMultipliers(mults) { this._meta = { ...this._meta, ...mults }; }

  // ── Derived multipliers (class × stat × passive × meta) ──────────────────

  getDamageMultiplier() {
    const cls = CLASS_DEFS[this._classId].mults;
    return cls.damage
      * (1 + this._stats.strength * 0.02)
      * (1 + this._passives.damageBonus)
      * this._meta.damageMult;
  }

  getAbilityDamageMultiplier() {
    const cls = CLASS_DEFS[this._classId].mults;
    return (cls.abilityDamage ?? 1.0)
      * (1 + this._stats.intelligence * 0.025)
      * (1 + this._passives.damageBonus + this._passives.abilityDmgBonus)
      * this._meta.damageMult;
  }

  // ── Mana system ───────────────────────────────────────────────────────────

  getManaPool()   { return Math.floor(this._stats.intelligence * 10 + this._stats.wisdom * 4); }
  getCurrentMana() { return this._mana; }

  getManaRegen() { return Math.max(0.5, this._stats.wisdom * 1.2); }

  /** Total mana regen including meditate skill contribution. */
  getManaRegenTotal() {
    const meditateVal = this.getComputedSkill('meditate');
    // meditate adds 0.15 mana/s per computed level; only available for mage
    return Math.max(0.5, this._stats.wisdom * 1.2 + meditateVal * 0.15);
  }

  consumeMana(cost) {
    if (this._mana < cost) return false;
    this._mana -= cost;
    return true;
  }

  restoreMana(amount) {
    this._mana = Math.min(this.getManaPool(), this._mana + amount);
  }

  // ── Ability-upgrade level system (fireball Lv1–10 etc) ───────────────────

  initSkills(skillIds) {
    for (const id of skillIds) {
      if (!(id in this._skillLevels)) this._skillLevels[id] = 1;
    }
  }

  getSkillLevel(skillId) { return this._skillLevels[skillId] ?? 1; }

  addSkillLevel(skillId) {
    const cur  = this._skillLevels[skillId] ?? 1;
    const next = Math.min(10, cur + 1);
    this._skillLevels[skillId] = next;
    this._eventBus?.emit('skill_leveled', { skillId, level: next });
    console.log(`[Build] Ability "${skillId}" → Lv${next}`);
    return next;
  }

  getAllSkillLevels() { return { ...this._skillLevels }; }

  // ── Astonia class skill system ─────────────────────────────────────────────
  //
  // Raw trained level stored in _classSkills[id].
  // Computed value = rawLevel × statMult; scales naturally with attribute investment.

  /** Internal: initialise raw skill levels from class definition. */
  _initClassSkills(classId) {
    const defs = CLASS_SKILLS[classId] ?? {};
    for (const [id, def] of Object.entries(defs)) {
      if (!(id in this._classSkills)) {
        this._classSkills[id] = def.base;
      }
    }
  }

  /**
   * Computed (effective) skill level.
   * Returns rawLevel × statMult.
   * Example: sword(raw=6), STR=8 → 6 × (1 + 8×0.7×0.02 + 4×0.3×0.02) = 6 × 1.136 ≈ 6
   */
  getComputedSkill(id) {
    const defs = CLASS_SKILLS[this._classId] ?? {};
    const def  = defs[id];
    if (!def) return 0;
    const raw = this._classSkills[id] ?? def.base;
    let mult = 1.0;
    for (const [stat, weight] of Object.entries(def.stats)) {
      mult += (this._stats[stat] ?? 0) * weight * 0.02;
    }
    return Math.floor(raw * mult);
  }

  /** Return raw (untrained) level of a class skill. */
  getRawSkill(id) {
    const defs = CLASS_SKILLS[this._classId] ?? {};
    return this._classSkills[id] ?? (defs[id]?.base ?? 0);
  }

  /** All class skill definitions for the current class, keyed by id. */
  getClassSkillDefs() { return CLASS_SKILLS[this._classId] ?? {}; }

  // ── Skill point allocation ────────────────────────────────────────────────

  /** Grant n unspent skill points (called from main.js on level_up). */
  grantSkillPoints(n = SKILL_POINTS_PER_LEVEL) {
    this._unspentSkillPoints += n;
    this._eventBus?.emit('skill_points_granted', { unspent: this._unspentSkillPoints });
  }

  getUnspentSkillPoints() { return this._unspentSkillPoints; }

  /**
   * Spend one skill point to raise a class skill by 1.
   * Returns true on success.
   */
  applySkillPoint(skillId) {
    if (this._unspentSkillPoints <= 0) {
      console.warn('[Build] No unspent skill points');
      return false;
    }
    const defs = CLASS_SKILLS[this._classId] ?? {};
    if (!defs[skillId]) {
      console.warn(`[Build] Unknown class skill: "${skillId}"`);
      return false;
    }
    this._unspentSkillPoints--;
    this._classSkills[skillId] = (this._classSkills[skillId] ?? defs[skillId].base) + 1;
    this._eventBus?.emit('class_skill_changed', {
      skillId,
      raw:      this._classSkills[skillId],
      computed: this.getComputedSkill(skillId),
      unspent:  this._unspentSkillPoints,
    });
    console.log(`[Build] Skill "${skillId}" → raw ${this._classSkills[skillId]}  computed ${this.getComputedSkill(skillId)}  (${this._unspentSkillPoints} pts left)`);
    return true;
  }

  // ── Skill-driven combat stats ──────────────────────────────────────────────
  //
  // These replace or complement the raw-stat-based multipliers for physical combat.
  // Mage spells use getSpellDamage() / getMagicShieldStats() instead.

  /**
   * Auto-attack weapon damage — fully skill-driven.
   *
   * Warrior: (sword × 3.2 + attack × 1.8 + tactics × 0.8) × STR bonus × class/meta mults
   * Rogue:   (dagger × 3.0 + attack × 1.5) × AGI/STR bonus × class/meta mults
   * Mage:    (staff × 2.0) × class/meta mults (weak melee)
   *
   * Falls back to BASE_DAMAGE if skills are missing.
   */
  getWeaponDamage() {
    const cls  = CLASS_DEFS[this._classId].mults;
    const mult = cls.damage * (1 + this._passives.damageBonus) * this._meta.damageMult;

    if (this._classId === 'warrior') {
      const sword    = this.getComputedSkill('sword');
      const attack   = this.getComputedSkill('attack');
      const tactics  = this.getComputedSkill('tactics');
      const rawBase  = sword * 3.2 + attack * 1.8 + tactics * 0.8;
      // STR is already partially baked in via computedSkill; apply a smaller flat bonus
      const strBonus = 1 + this._stats.strength * 0.015;
      const dmg = Math.floor(rawBase * strBonus * mult);
      if (typeof __debug !== 'undefined' && __debug?.build?._debug) {
        console.log(`[WeaponDmg] sword=${sword} attack=${attack} tactics=${tactics} base=${rawBase.toFixed(1)} final=${dmg}`);
      }
      return dmg;
    }

    if (this._classId === 'rogue') {
      const dagger = this.getComputedSkill('dagger');
      const attack = this.getComputedSkill('attack');
      const rawBase = dagger * 3.0 + attack * 1.5;
      const agiBonus = 1 + this._stats.agility * 0.012;
      return Math.floor(rawBase * agiBonus * mult);
    }

    // Mage auto-attack (weak)
    const staff = this.getComputedSkill('staff');
    if (staff > 0) return Math.floor(staff * 2.0 * mult);
    return Math.floor(BASE_DAMAGE * 0.6 * mult); // fallback
  }

  /**
   * Attack speed — seconds between auto-attacks.
   * Lower = faster.
   *
   * Warrior:  speed + speedSkill reduce cooldown.
   * Rogue:    speed + AGI multiplier.
   * Mage:     base speed only (slow auto).
   */
  getAttackSpeed() {
    const BASE_CD = 0.50;
    const speedVal = this.getComputedSkill('speed');
    const speedSkillVal = this._classId === 'warrior'
      ? this.getComputedSkill('speedSkill')
      : 0;
    const agiBonus = this._stats.agility * 0.003;
    const reduction = Math.min(0.55, speedVal * 0.004 + speedSkillVal * 0.003 + agiBonus);
    return Math.max(0.20, BASE_CD * (1 - reduction));
  }

  /**
   * Armor damage reduction (0–0.60).
   * Scales with armorSkill (or bodyControl for secondary).
   */
  getArmorReduction() {
    const armorVal = this.getComputedSkill('armorSkill');
    const bodyCtrl = this.getComputedSkill('bodyControl') * 0.3; // secondary
    return Math.min(0.60, (armorVal + bodyCtrl) * 0.008);
  }

  /**
   * HP regeneration per second from regenerate skill.
   * Ticked in abilitySystem.update().
   */
  getHpRegen() {
    const regenVal = this.getComputedSkill('regenerate');
    return Math.max(0, regenVal * 0.05);
  }

  /**
   * AoE radius when surround hit is active.
   * Small at base, grows with surroundHit skill investment.
   */
  getSurroundRadius() {
    const sh = this.getComputedSkill('surroundHit');
    return 2.0 + sh * 0.04;  // range: ~2.1 (base) → ~5.0 (skill 75)
  }

  /**
   * Damage per surroundHit swing as a fraction of weapon damage.
   * All targets get full damage at low skill; penalty is minimal.
   * Astonia: surround hit doesn't reduce damage much.
   */
  getSurroundDamageMult() {
    const sh = this.getComputedSkill('surroundHit');
    // Approaches 1.0 as skill grows; starts at 0.85
    return Math.min(1.0, 0.85 + sh * 0.002);
  }

  /**
   * Mage spell damage = computedSkill(skillId) × scalar × abilityDamageMultiplier.
   * @param {string} skillId   — 'fire' | 'lightning' | 'pulse' | 'magicShield'
   * @param {number} scalar    — ability-specific base multiplier (tuneable constant)
   */
  getSpellDamage(skillId, scalar) {
    const computed = this.getComputedSkill(skillId);
    const mult     = this.getAbilityDamageMultiplier();
    const dmg      = Math.floor(computed * scalar * mult);
    if (typeof __debug !== 'undefined' && __debug?.build?._debug) {
      console.log(`[SpellDmg] skill=${skillId}(${computed}) × scalar=${scalar} × mult=${mult.toFixed(3)} = ${dmg}`);
    }
    return dmg;
  }

  /**
   * Magic Shield stats derived from magicShield skill + duration skill.
   * @returns {{ value: number, duration: number }}
   */
  getMagicShieldStats() {
    const shieldSkill   = this.getComputedSkill('magicShield');
    const durationSkill = this.getComputedSkill('duration');
    const value    = Math.floor(shieldSkill * 3.5);
    const duration = Math.min(15, 3 + durationSkill * 0.25);
    return { value, duration };
  }

  /**
   * Lightning pulse duration based on pulse skill + duration skill.
   * @returns {number} seconds
   */
  getPulseDuration() {
    const pulseVal    = this.getComputedSkill('pulse');
    const durationVal = this.getComputedSkill('duration');
    return Math.min(4.0, 0.8 + pulseVal * 0.04 + durationVal * 0.06);
  }

  /** Warcry stun duration in seconds. */
  getWarcryStuDuration() {
    const warcrySkill = this.getComputedSkill('warcry');
    return Math.min(3.0, 0.8 + warcrySkill * 0.025);
  }

  /** Warcry AoE radius. */
  getWarcryRadius() {
    const warcrySkill = this.getComputedSkill('warcry');
    return 3.0 + warcrySkill * 0.06;
  }

  /**
   * Derived stats for the UI panel (read-only display values).
   * @returns {{ weapon:number, speed:number, armor:number, offense:number, defense:number }}
   */
  getDerivedStats() {
    const weapon  = this.getWeaponDamage();
    const speedMs = Math.round(this.getAttackSpeed() * 1000);
    const armor   = Math.round(this.getArmorReduction() * 100);
    const offense = Math.round(this.getDamageMultiplier() * 100);
    const defense = Math.round((this.getArmorReduction() + this.getDamageReduction()) * 100 / 2);
    return { weapon, speedMs, armor, offense, defense };
  }

  // ── Existing derived multipliers ──────────────────────────────────────────

  getSpeedMultiplier() {
    const cls = CLASS_DEFS[this._classId].mults;
    return cls.speed
      * (1 + this._stats.agility * 0.015)
      * (1 + this._passives.speedBonus)
      * this._meta.speedMult;
  }

  getMaxHP() {
    const cls = CLASS_DEFS[this._classId].mults;
    return Math.round(
      BASE_HP
      * cls.hp
      * (1 + this._stats.vitality * 0.03)
      * (1 + this._passives.hpBonus)
      * this._meta.hpMult,
    );
  }

  getCritChance() {
    const cls = CLASS_DEFS[this._classId].mults;
    return (this._stats.agility * 0.003 * cls.crit)
      + this._passives.critBonus
      + this._meta.critMult;
  }

  getCritMultiplier() { return 1.5 + this._passives.critMultBonus; }

  getCooldownReduction() {
    return Math.min(0.75,
      this._passives.cooldownReduction + this._stats.wisdom * 0.008
    );
  }

  getDamageReduction() {
    return Math.min(0.60, this._passives.defenseBonus);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save() {
    return {
      classId:            this._classId,
      level:              this._level,
      stats:              { ...this._stats },
      passives:           { ...this._passives },
      unspentPoints:      this._unspentPoints,
      unspentSkillPoints: this._unspentSkillPoints,
      mana:               this._mana,
      classSkills:        { ...this._classSkills },
    };
  }

  load(data) {
    if (!data) return;
    const classId = data.classId ?? 'warrior';
    if (CLASS_DEFS[classId]) this._classId = classId;
    this._level              = data.level              ?? 1;
    this._stats              = { ...CLASS_DEFS[this._classId].baseStats, ...(data.stats ?? {}) };
    this._passives           = { ..._emptyPassives(), ...(data.passives ?? {}) };
    this._unspentPoints      = data.unspentPoints      ?? 0;
    this._unspentSkillPoints = data.unspentSkillPoints ?? 0;
    this._mana               = Math.min(data.mana ?? this.getManaPool(), this.getManaPool());
    // Restore class skills (over the defaults already set by setClass via constructor)
    if (data.classSkills) {
      this._classSkills = { ...this._classSkills, ...data.classSkills };
    }
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    const cls = CLASS_DEFS[this._classId];
    console.group(`[Build] ${cls.name} (Level ${this._level})`);
    const s = this._stats;
    console.log(`Stats:  STR ${s.strength}  AGI ${s.agility}  INT ${s.intelligence}  VIT ${s.vitality}  WIS ${s.wisdom}`);
    if (this._unspentPoints > 0)
      console.log(`%c  ★ ${this._unspentPoints} unspent stat point(s)`, 'color:#f1c40f');
    if (this._unspentSkillPoints > 0)
      console.log(`%c  ◆ ${this._unspentSkillPoints} unspent skill point(s)`, 'color:#88eeff');
    console.log(`Weapon:       ${this.getWeaponDamage()} dmg  @  ${this.getAttackSpeed().toFixed(2)}s/swing`);
    console.log(`Armor:        ${(this.getArmorReduction() * 100).toFixed(0)}% reduction`);
    console.log(`HP regen:     ${this.getHpRegen().toFixed(2)} HP/s`);
    console.log(`Phys.dmg ×:   ${this.getDamageMultiplier().toFixed(3)}`);
    console.log(`Spell.dmg ×:  ${this.getAbilityDamageMultiplier().toFixed(3)}`);
    console.log(`Speed mult:   ×${this.getSpeedMultiplier().toFixed(3)}`);
    console.log(`Max HP:       ${this.getMaxHP()}`);
    console.log(`Mana:         ${Math.floor(this._mana)} / ${this.getManaPool()}  (regen ${this.getManaRegenTotal().toFixed(1)}/s)`);
    console.log(`Crit:         ${(this.getCritChance() * 100).toFixed(1)}%  ×${this.getCritMultiplier().toFixed(2)}`);
    console.log(`CDR:          ${(this.getCooldownReduction() * 100).toFixed(0)}%`);
    // Class skill table
    const defs = this.getClassSkillDefs();
    console.group('Class Skills:');
    for (const [id, def] of Object.entries(defs)) {
      const raw  = this._classSkills[id] ?? def.base;
      const comp = this.getComputedSkill(id);
      console.log(`  ${def.label.padEnd(14)} raw=${raw}  computed=${comp}`);
    }
    console.groupEnd();
    console.groupEnd();
  }
}

function _emptyPassives() {
  return {
    damageBonus: 0, hpBonus: 0, speedBonus: 0, critBonus: 0,
    abilityDmgBonus: 0, critMultBonus: 0, cooldownReduction: 0, defenseBonus: 0,
  };
}
