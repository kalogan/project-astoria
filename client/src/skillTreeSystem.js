// Skill tree system — per-class trees of passive and ability-unlock nodes.
//
// Players earn 1 skill point per level. Nodes have prerequisites and cost 1-3 points.
// Passive nodes call buildManager.addPassive(effect).
// Ability nodes call abilitySystem.upgradeSlot1(abilityId).
//
// Node layout uses { row, col } for a CSS grid (5 columns × 4 rows).

// ── Tree definitions ──────────────────────────────────────────────────────────

const TREES = {

  warrior: [
    {
      id: 'w_power', name: 'Power Strike', cost: 1, row: 0, col: 0, type: 'passive',
      desc: '+15% damage to all attacks.',
      requires: [],
      effect: { type: 'damage', value: 0.15 },
    },
    {
      id: 'w_vitality', name: 'Iron Will', cost: 1, row: 1, col: 0, type: 'passive',
      desc: '+20% max HP.',
      requires: ['w_power'],
      effect: { type: 'hp', value: 0.20 },
    },
    {
      id: 'w_warcry', name: 'War Cry', cost: 1, row: 1, col: 2, type: 'ability',
      desc: 'Unlocks War Cry: AoE damage around the warrior.',
      requires: ['w_power'],
      effect: { type: 'unlock_ability', abilityId: 'war_cry' },
    },
    {
      id: 'w_heavy', name: 'Heavy Blows', cost: 2, row: 2, col: 0, type: 'passive',
      desc: '+10% damage.',
      requires: ['w_vitality'],
      effect: { type: 'damage', value: 0.10 },
    },
    {
      id: 'w_parry', name: 'Parry', cost: 1, row: 2, col: 4, type: 'ability',
      desc: 'Unlocks Parry: 2s damage reduction (50%). Replaces F slot.',
      requires: ['w_power'],
      effect: { type: 'unlock_ability', abilityId: 'parry' },
    },
    {
      id: 'w_berserker', name: 'Berserker', cost: 2, row: 2, col: 2, type: 'passive',
      desc: '+15% critical hit chance.',
      requires: ['w_warcry'],
      effect: { type: 'crit', value: 0.15 },
    },
    {
      id: 'w_unstoppable', name: 'Unstoppable', cost: 3, row: 3, col: 1, type: 'passive',
      desc: '+25% max HP.',
      requires: ['w_heavy', 'w_berserker'],
      effect: { type: 'hp', value: 0.25 },
    },
  ],

  rogue: [
    {
      id: 'r_quickness', name: 'Quickness', cost: 1, row: 0, col: 0, type: 'passive',
      desc: '+10% movement speed.',
      requires: [],
      effect: { type: 'speed', value: 0.10 },
    },
    {
      id: 'r_knife', name: 'Knife Edge', cost: 1, row: 1, col: 0, type: 'passive',
      desc: '+15% critical hit chance.',
      requires: ['r_quickness'],
      effect: { type: 'crit', value: 0.15 },
    },
    {
      id: 'r_shadow', name: 'Shadow Step', cost: 1, row: 1, col: 2, type: 'passive',
      desc: '+15% movement speed.',
      requires: ['r_quickness'],
      effect: { type: 'speed', value: 0.15 },
    },
    {
      id: 'r_evasion', name: 'Evasion', cost: 2, row: 2, col: 0, type: 'passive',
      desc: '-15% incoming enemy damage.',
      requires: ['r_knife'],
      effect: { type: 'defense', value: 0.15 },
    },
    {
      id: 'r_lethal', name: 'Lethal Precision', cost: 2, row: 2, col: 2, type: 'passive',
      desc: '+25% damage.',
      requires: ['r_shadow'],
      effect: { type: 'damage', value: 0.25 },
    },
    {
      id: 'r_deathstrike', name: 'Death Strike', cost: 3, row: 3, col: 1, type: 'passive',
      desc: '+0.40 critical damage multiplier (crits now deal 1.9× damage).',
      requires: ['r_evasion', 'r_lethal'],
      effect: { type: 'crit_mult', value: 0.40 },
    },
  ],

  mage: [
    {
      id: 'm_arcane', name: 'Arcane Focus', cost: 1, row: 0, col: 0, type: 'passive',
      desc: '+15% ability damage.',
      requires: [],
      effect: { type: 'ability_damage', value: 0.15 },
    },
    {
      id: 'm_shield', name: 'Mana Shield', cost: 1, row: 1, col: 0, type: 'passive',
      desc: '-10% incoming enemy damage.',
      requires: ['m_arcane'],
      effect: { type: 'defense', value: 0.10 },
    },
    {
      id: 'm_nova', name: 'Nova', cost: 1, row: 1, col: 2, type: 'ability',
      desc: 'Unlocks Nova: massive AoE arcane burst.',
      requires: ['m_arcane'],
      effect: { type: 'unlock_ability', abilityId: 'nova' },
    },
    {
      id: 'm_amplify', name: 'Amplify Magic', cost: 2, row: 2, col: 0, type: 'passive',
      desc: '+25% ability damage.',
      requires: ['m_shield', 'm_nova'],
      effect: { type: 'ability_damage', value: 0.25 },
    },
    {
      id: 'm_archmage', name: 'Archmage', cost: 2, row: 2, col: 2, type: 'passive',
      desc: '-25% ability cooldowns.',
      requires: ['m_nova'],
      effect: { type: 'cdr', value: 0.25 },
    },
    {
      id: 'm_mastery', name: 'Spell Mastery', cost: 3, row: 3, col: 1, type: 'passive',
      desc: '+40% ability damage.',
      requires: ['m_amplify', 'm_archmage'],
      effect: { type: 'ability_damage', value: 0.40 },
    },
  ],
};

// ── SkillTreeSystem ───────────────────────────────────────────────────────────

export class SkillTreeSystem {
  constructor() {
    this._classId  = 'warrior';
    this._unlocked = new Set();
    this._points   = 0;
    this._eventBus = null;
  }

  init(_zone, _registry, eventBus) {
    this._eventBus = eventBus;
  }

  setClass(classId) {
    this._classId = classId;
  }

  // Called on level_up from main.js
  addSkillPoint() {
    this._points++;
    this._eventBus?.emit('skill_point_gained', { points: this._points });
  }

  getPoints() { return this._points; }

  // Returns all nodes for the current class.
  getClassNodes(classId = null) {
    return TREES[classId ?? this._classId] ?? [];
  }

  isUnlocked(nodeId) { return this._unlocked.has(nodeId); }

  canUnlock(nodeId) {
    if (this._unlocked.has(nodeId)) return false;
    const node = this._findNode(nodeId);
    if (!node) return false;
    return node.requires.every(r => this._unlocked.has(r));
  }

  // Attempt to unlock a node. Returns true on success.
  unlock(nodeId, build, abilitySys) {
    const node = this._findNode(nodeId);
    if (!node) { console.warn(`[SkillTree] Unknown node: "${nodeId}"`); return false; }
    if (this._unlocked.has(nodeId))         { console.warn(`[SkillTree] Already unlocked: "${nodeId}"`); return false; }
    if (this._points < node.cost)           { console.warn(`[SkillTree] Not enough points (${this._points}/${node.cost})`); return false; }
    if (!node.requires.every(r => this._unlocked.has(r))) {
      console.warn(`[SkillTree] Requires: ${node.requires.filter(r => !this._unlocked.has(r)).join(', ')}`);
      return false;
    }

    this._points -= node.cost;
    this._unlocked.add(nodeId);
    this._applyNode(node, build, abilitySys);
    this._eventBus?.emit('skill_unlocked', { nodeId, name: node.name, points: this._points });
    console.log(`[SkillTree] Unlocked "${node.name}" (${this._points} pts remaining)`);
    return true;
  }

  // Force-unlock a node without spending points (debug / save restore).
  applyUnlocked(nodeId, build, abilitySys) {
    const node = this._findNode(nodeId);
    if (!node || this._unlocked.has(nodeId)) return;
    this._unlocked.add(nodeId);
    this._applyNode(node, build, abilitySys);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save() {
    return {
      classId:  this._classId,
      unlocked: [...this._unlocked],
      points:   this._points,
    };
  }

  load(data, build, abilitySys) {
    if (!data) return;
    this._classId = data.classId ?? 'warrior';
    this._points  = data.points  ?? 0;
    for (const id of (data.unlocked ?? [])) {
      this.applyUnlocked(id, build, abilitySys);
    }
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    const nodes = TREES[this._classId] ?? [];
    console.group(`[SkillTree] ${this._classId} (${this._points} points)`);
    for (const n of nodes) {
      const status = this._unlocked.has(n.id) ? '✓' : this.canUnlock(n.id) ? '○' : '🔒';
      console.log(`  ${status} ${n.name} (cost:${n.cost}) — ${n.desc}`);
    }
    console.groupEnd();
  }

  unlockAll(build, abilitySys) {
    for (const n of TREES[this._classId] ?? []) {
      this.applyUnlocked(n.id, build, abilitySys);
    }
    console.log('[SkillTree] All nodes unlocked');
  }

  reset(build) {
    this._unlocked.clear();
    build?.resetPassives();
    console.log('[SkillTree] Reset');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _findNode(nodeId) {
    for (const tree of Object.values(TREES)) {
      const node = tree.find(n => n.id === nodeId);
      if (node) return node;
    }
    return null;
  }

  _applyNode(node, build, abilitySys) {
    const { type } = node.effect;
    if (type === 'unlock_ability') {
      abilitySys?.upgradeSlot1(node.effect.abilityId);
    } else {
      build?.addPassive(node.effect);
    }
  }
}
