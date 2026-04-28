// Modifier system — per-run affixes that alter dungeon conditions.
//
// Modifiers are stateless definitions; the system manages which are active
// and applies/removes their effects each dungeon run.
//
// Types: enemy | player | world
// Applied via modifierSystem.applyAll(modifiers, ctx) on dungeon start.
// Removed via modifierSystem.removeAll(modifiers) on dungeon end.

import { createRNG } from './rng.js';

// ── Modifier definitions ──────────────────────────────────────────────────────

export const MODIFIER_DEFS = [
  // ── Enemy modifiers ──────────────────────────────────────────────────────
  {
    id: 'enraged', name: 'Enraged', type: 'enemy',
    desc: 'Enemies deal 30% more damage.',
    minDifficulty: 1,
    apply({ registry }) {
      for (const e of registry?.getEntitiesByType('enemy') ?? []) {
        e._modEnragedOrig   = e.attackDamage;
        e.attackDamage      = Math.floor(e.attackDamage * 1.30);
      }
    },
    remove({ registry }) {
      for (const e of registry?.getEntitiesByType('enemy') ?? []) {
        if (e._modEnragedOrig != null) {
          e.attackDamage      = e._modEnragedOrig;
          e._modEnragedOrig   = null;
        }
      }
    },
  },
  {
    id: 'swarm', name: 'Swarm', type: 'enemy',
    desc: 'Enemies move 25% faster.',
    minDifficulty: 1,
    apply({ registry }) {
      for (const e of registry?.getEntitiesByType('enemy') ?? []) {
        e._modSwarmOrig = e._speed;
        e._speed        = e._speed * 1.25;
      }
    },
    remove({ registry }) {
      for (const e of registry?.getEntitiesByType('enemy') ?? []) {
        if (e._modSwarmOrig != null) {
          e._speed        = e._modSwarmOrig;
          e._modSwarmOrig = null;
        }
      }
    },
  },
  {
    id: 'tanky', name: 'Tanky', type: 'enemy',
    desc: 'Enemies have 60% more HP.',
    minDifficulty: 2,
    apply({ registry }) {
      for (const e of registry?.getEntitiesByType('enemy') ?? []) {
        e._modTankyOrig = e.maxHp;
        e.maxHp         = Math.floor(e.maxHp * 1.60);
        e.hp            = Math.min(e.hp, e.maxHp);
      }
    },
    remove({ registry }) {
      for (const e of registry?.getEntitiesByType('enemy') ?? []) {
        if (e._modTankyOrig != null) {
          e.maxHp         = e._modTankyOrig;
          e.hp            = Math.min(e.hp, e.maxHp);
          e._modTankyOrig = null;
        }
      }
    },
  },

  // ── Player modifiers ──────────────────────────────────────────────────────
  {
    id: 'glass_cannon', name: 'Glass Cannon', type: 'player',
    desc: '+40% damage dealt, -30% max HP.',
    minDifficulty: 1,
    apply({ build }) {
      build?.addPassive({ type: 'damage', value:  0.40 });
      build?.addPassive({ type: 'hp',     value: -0.30 });
    },
    remove({ build }) {
      build?.resetPassives();
    },
  },
  {
    id: 'slow_recovery', name: 'Slow Recovery', type: 'player',
    desc: 'No HP regen from level-ups during this run.',
    minDifficulty: 2,
    apply()  { /* hook: level_up heal suppressed in main.js when modifier active */ },
    remove() {},
  },

  // ── World modifiers ───────────────────────────────────────────────────────
  {
    id: 'riches', name: 'Riches', type: 'world',
    desc: '+60% XP and loot drops.',
    minDifficulty: 1,
    apply({ eventBus }) {
      eventBus?.emit('modifier_world_xp_boost', { mult: 1.60 });
    },
    remove({ eventBus }) {
      eventBus?.emit('modifier_world_xp_boost', { mult: 1.00 });
    },
  },
  {
    id: 'darkness', name: 'Darkness', type: 'world',
    desc: 'Enemies outside 6 tiles don\'t aggro.',
    minDifficulty: 2,
    apply({ aiSystem }) {
      aiSystem?.setAggroRadius(6);
    },
    remove({ aiSystem }) {
      aiSystem?.setAggroRadius(8);
    },
  },
  {
    id: 'chaos', name: 'Chaos', type: 'world',
    desc: 'Random chaos events every 30 seconds.',
    minDifficulty: 3,
    apply({ eventBus }) {
      this._chaosInterval = setInterval(() => {
        eventBus?.emit('chaos_event', {
          type: Math.random() < 0.5 ? 'enrage_burst' : 'loot_shower',
        });
      }, 30_000);
    },
    remove() {
      clearInterval(this._chaosInterval);
    },
  },
];

const MODIFIER_MAP = new Map(MODIFIER_DEFS.map(m => [m.id, m]));

// ── ModifierSystem ────────────────────────────────────────────────────────────

export class ModifierSystem {
  constructor() {
    this._active = []; // currently applied modifiers
  }

  // Roll 1–3 random modifiers for a given difficulty tier using a seed
  rollModifiers(difficulty, seed = Date.now()) {
    const rng     = createRNG(seed & 0x7FFFFFFF);
    const eligible = MODIFIER_DEFS.filter(m => m.minDifficulty <= difficulty);
    if (!eligible.length) return [];

    const count = Math.min(eligible.length, Math.min(3, 1 + Math.floor((difficulty - 1) / 3)));
    const pool  = [...eligible];
    const picks = [];

    for (let i = 0; i < count && pool.length; i++) {
      const idx = rng.nextInt(0, pool.length - 1);
      picks.push(pool.splice(idx, 1)[0]);
    }

    return picks;
  }

  // Apply a list of modifiers. ctx: { registry, build, aiSystem, eventBus }
  applyAll(modifiers, ctx) {
    for (const mod of modifiers) {
      const def = typeof mod === 'string' ? MODIFIER_MAP.get(mod) : mod;
      if (!def) { console.warn(`[Modifier] Unknown: ${mod}`); continue; }
      def.apply?.(ctx);
      this._active.push(def);
      ctx.eventBus?.emit('modifier_applied', { id: def.id, name: def.name, type: def.type });
      console.log(`[Modifier] Applied: ${def.name}`);
    }
  }

  // Remove all currently active modifiers
  removeAll(ctx = {}) {
    for (const def of this._active) {
      def.remove?.(ctx);
      ctx.eventBus?.emit('modifier_removed', { id: def.id });
    }
    this._active = [];
  }

  getActive()      { return [...this._active]; }
  isActive(id)     { return this._active.some(m => m.id === id); }
  getModifier(id)  { return MODIFIER_MAP.get(id) ?? null; }

  inspect() {
    if (!this._active.length) { console.log('[Modifier] None active'); return; }
    console.group('[Modifier] Active');
    for (const m of this._active) console.log(`  ${m.type.toUpperCase()}  ${m.name} — ${m.desc}`);
    console.groupEnd();
  }
}
