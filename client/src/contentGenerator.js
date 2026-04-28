// Content generator — enriches a generated zone with typed enemy profiles,
// loot tables, quest objectives, and behavior assignments.
//
// Called after zoneGenerator produces a layout. Annotates zone.systems in-place.
//
// Pipeline: zoneGenerator (layout) → enrichZone (systems) → final zone

import { createRNG } from './rng.js';

// ── Data tables ───────────────────────────────────────────────────────────────

const ENEMY_TYPES = {
  melee:  { baseHp: 80,  baseSpeed: 2.5, baseAttack: 10, color: 0xff4400, baseXp: 10 },
  ranged: { baseHp: 60,  baseSpeed: 2.0, baseAttack: 12, color: 0xff8800, baseXp: 12 },
  tank:   { baseHp: 150, baseSpeed: 1.5, baseAttack: 8,  color: 0xcc0000, baseXp: 18 },
};

const DIFFICULTY_SCALE = {
  easy:   { hp: 0.65, xp: 0.7,  attack: 0.7,  gold: [5,  15]  },
  medium: { hp: 1.00, xp: 1.0,  attack: 1.0,  gold: [15, 40]  },
  hard:   { hp: 1.40, xp: 1.4,  attack: 1.35, gold: [35, 75]  },
  boss:   { hp: 2.00, xp: 2.5,  attack: 1.80, gold: [80, 150] },
};

// Type pool by zone type — cycled across enemy slots
const TYPE_POOL = {
  hub:     ['melee'],
  forest:  ['melee', 'melee', 'ranged'],
  dungeon: ['melee', 'melee', 'ranged', 'tank'],
  boss:    ['melee', 'ranged', 'tank', 'tank'],
};

// narrativeRole → quest factory
const ROLE_QUESTS = {
  start:       (rng, _count) => [_killQuest(rng, rng.nextInt(3, 5),  'Clear the Area')],
  progression: (rng, _count) => [_killQuest(rng, rng.nextInt(4, 7),  'Patrol and Purge')],
  challenge:   (rng, count)  => [_killQuest(rng, Math.max(3, Math.floor(count * 0.6)), 'Eliminate All Threats')],
  climax:      (_rng, _count) => [_bossQuest()],
};

const THEME_TO_ROLE = {
  hub:     'start',
  forest:  'progression',
  dungeon: 'challenge',
  boss:    'climax',
};

// Behavior by enemy type
const TYPE_BEHAVIOR = {
  melee:  'chase',
  ranged: 'patrol',
  tank:   'guard',
};

let _questSeq = 0;
let _encSeq   = 0;

// ── Encounter templates by narrative role ─────────────────────────────────────

function _makeEncounters(role, rng, enemyCount, center) {
  const tp = center ?? { x: 0, z: 0 };
  switch (role) {
    case 'start':
      return [{
        id: `enc_${++_encSeq}_patrol`,
        type: 'wave',
        trigger: { type: 'area', position: tp, radius: 4 },
        waves: [{ enemies: [{ type: 'melee', count: 2 }], delay: 0.5 }],
        conditions: { completeOn: 'all_enemies_dead' },
        reward: { xp: 20, gold: 10 },
      }];
    case 'progression':
      return [{
        id: `enc_${++_encSeq}_ambush`,
        type: 'ambush',
        trigger: { type: 'area', position: tp, radius: 3 },
        waves: [{
          enemies: [{ type: 'melee', count: 2 }, { type: 'ranged', count: 1 }],
          delay: 0,
        }],
        conditions: { completeOn: 'all_enemies_dead' },
        reward: { xp: 35, gold: 15 },
      }];
    case 'challenge':
      return [{
        id: `enc_${++_encSeq}_wave`,
        type: 'wave',
        trigger: { type: 'area', position: { x: tp.x + rng.nextFloat(-2, 2), z: tp.z + rng.nextFloat(-2, 2) }, radius: 4 },
        waves: [
          { enemies: [{ type: 'melee', count: Math.max(1, Math.floor(enemyCount * 0.4)) }], delay: 0 },
          { enemies: [{ type: 'ranged', count: 2 }, { type: 'melee', count: 1 }],           delay: 2 },
        ],
        conditions: { completeOn: 'all_enemies_dead' },
        reward: { xp: 60, gold: 30 },
      }];
    case 'climax':
      return [{
        id: `enc_${++_encSeq}_boss`,
        type: 'boss',
        trigger: { type: 'area', position: tp, radius: 5 },
        waves: [{
          enemies: [
            { type: 'tank',  count: 1, hp: 400, attackDamage: 25, xpValue: 50 },
            { type: 'melee', count: 2 },
          ],
          delay: 0,
        }],
        conditions: { completeOn: 'all_enemies_dead' },
        reward: { xp: 150, gold: 80 },
      }];
    default:
      return [];
  }
}

function _killQuest(rng, goal, title) {
  const titles = [title, 'Defeat Enemies', 'Purge the Zone', 'Neutralize Threats'];
  return {
    id:    `q_gen_${++_questSeq}`,
    type:  'kill',
    title: titles[rng.nextInt(0, titles.length - 1)],
    goal,
  };
}

function _bossQuest() {
  return {
    id:    `q_boss_${++_questSeq}`,
    type:  'kill',
    title: 'Defeat the Boss',
    goal:  1,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

// Generate content from a zone object + metadata.
// Does NOT mutate the zone — call enrichZone for in-place annotation.
export function generateContent(zone, { zoneType = 'dungeon', difficulty = 'medium', narrativeRole = null, seed }) {
  const role   = narrativeRole ?? THEME_TO_ROLE[zoneType] ?? 'challenge';
  const rng    = createRNG(seed);
  const scale  = DIFFICULTY_SCALE[difficulty] ?? DIFFICULTY_SCALE.medium;
  const pool   = TYPE_POOL[zoneType] ?? TYPE_POOL.dungeon;
  const enemies = zone.systems?.enemies ?? [];

  // Enemy profiles — type cycles through pool, stats scaled by difficulty
  const enemyProfiles = enemies.map((en, i) => {
    const type  = pool[i % pool.length];
    const base  = ENEMY_TYPES[type];
    return {
      entityId:     en.entityId,
      type,
      hp:           Math.round(base.baseHp     * scale.hp),
      speed:        base.baseSpeed,
      attackDamage: Math.round(base.baseAttack * scale.attack),
      color:        base.color,
      xpValue:      Math.round(base.baseXp     * scale.xp),
    };
  });

  // Quest objectives driven by narrative role
  const quests = (ROLE_QUESTS[role] ?? ROLE_QUESTS.challenge)(rng, enemies.length);

  // Loot table
  const lootTable = {
    goldMin:        scale.gold[0],
    goldMax:        scale.gold[1],
    itemChance:     difficulty === 'boss' ? 1.0
                  : difficulty === 'hard' ? 0.50
                  : difficulty === 'medium' ? 0.25 : 0.10,
    rarChance:      difficulty === 'boss' ? 0.60
                  : difficulty === 'hard' ? 0.20
                  : difficulty === 'medium' ? 0.08 : 0.02,
    guaranteedRare: difficulty === 'boss',
  };

  // Behavior assignments
  const behaviors = enemyProfiles.map(ep => ({
    entityId: ep.entityId,
    behavior: TYPE_BEHAVIOR[ep.type] ?? 'chase',
  }));

  // Encounter definitions
  const center = zone.config ? {
    x: 0, z: 0, // generated zones center at origin
  } : null;
  const encounters = _makeEncounters(role, rng, enemies.length, center);

  return { enemyProfiles, lootTable, quests, behaviors, encounters };
}

// Mutate zone.systems in-place to add generated content.
// Annotates enemy entries, merges quests, stores lootTable + behaviors.
export function enrichZone(zone, meta) {
  const content = generateContent(zone, meta);

  // Annotate enemy entries with profile data
  const profileMap = new Map(content.enemyProfiles.map(ep => [ep.entityId, ep]));
  for (const en of zone.systems.enemies ?? []) {
    const p = profileMap.get(en.entityId);
    if (p) {
      en.type         = p.type;
      en.hp           = p.hp;
      en.speed        = p.speed;
      en.attackDamage = p.attackDamage;
      en.color        = p.color;
      en.xpValue      = p.xpValue;
    }
  }

  // Merge generated quests (skip duplicate ids)
  const existing = new Set((zone.systems.quests ?? []).map(q => q.id));
  zone.systems.quests ??= [];
  for (const q of content.quests) {
    if (!existing.has(q.id)) zone.systems.quests.push(q);
  }

  zone.systems.lootTable  = content.lootTable;
  zone.systems.behaviors  = content.behaviors;
  zone.systems.encounters = content.encounters ?? [];

  return content;
}

// Convenience: log a content summary for a zone.
export function logContent(zone) {
  const sys = zone.systems;
  const profiles = (sys.enemies ?? []).filter(e => e.type);
  const typeCounts = {};
  for (const e of profiles) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;

  console.group(`[Content] "${zone.id}"`);
  console.log('Enemies:', Object.entries(typeCounts).map(([t, n]) => `${n}× ${t}`).join(', ') || 'none');
  console.log('Quests:', (sys.quests ?? []).map(q => `${q.title} (${q.type}×${q.goal})`).join(', ') || 'none');
  if (sys.lootTable) {
    const lt = sys.lootTable;
    console.log(`Loot: gold ${lt.goldMin}–${lt.goldMax}, item ${(lt.itemChance * 100).toFixed(0)}%, rare ${(lt.rarChance * 100).toFixed(0)}%${lt.guaranteedRare ? ' [guaranteed rare]' : ''}`);
  }
  console.groupEnd();
}
