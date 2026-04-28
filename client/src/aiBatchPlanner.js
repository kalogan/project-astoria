// AI batch planner — converts high-level prompt configs into structured zone input arrays.
//
// Pipeline: generateFromPrompt → planBatch → generateZoneBatch
//
// Input shape:
//   { theme, count, progression, zoneTypes?, seed?, targetZone? }
//
// progression values: 'easy_to_hard' | 'flat_medium' | 'flat_hard' | 'boss_rush'
// zoneTypes defaults to ['hub', 'forest', 'dungeon', 'boss']

import { generateZoneBatch } from './batchZoneGenerator.js';
import { createRNG }         from './rng.js';

// ── Example ───────────────────────────────────────────────────────────────────

export const EXAMPLE_PROMPT = {
  theme:      'Cameron region',
  count:      8,
  progression: 'easy_to_hard',
};

// ── Public API ────────────────────────────────────────────────────────────────

// Returns inputs array (no generation). Useful for previewing the plan.
export function planBatch(promptConfig) {
  const {
    theme       = 'unnamed',
    count       = 5,
    progression = 'easy_to_hard',
    zoneTypes   = ['hub', 'forest', 'dungeon', 'boss'],
    seed,
    targetZone,
  } = promptConfig ?? {};

  const safeName    = theme.toLowerCase().replace(/\s+/g, '_');
  const plannerSeed = seed != null ? (seed >>> 0) : _hashStr(theme);
  const rng         = createRNG(plannerSeed);

  const difficulties = _difficultySequence(count, progression);
  const types        = _typeSequence(count, zoneTypes, rng);

  const inputs = [];
  for (let i = 0; i < count; i++) {
    inputs.push(_buildInput(i, types[i], difficulties[i], safeName, plannerSeed, targetZone));
  }

  _logPlan(theme, count, progression, plannerSeed, inputs);
  return inputs;
}

// Main entry point: planBatch → generateZoneBatch.
// Returns { inputs, succeeded, failed }
export function generateFromPrompt(promptConfig) {
  console.group(`[Planner] generateFromPrompt`);
  const inputs = planBatch(promptConfig);
  const result = generateZoneBatch(inputs);
  console.log(
    `[Planner] Complete — ${result.succeeded.length} zones ready,`,
    `${result.failed.length} failed.`,
  );
  console.groupEnd();
  return { inputs, ...result };
}

// ── Sequence builders ─────────────────────────────────────────────────────────

// Phase-based difficulty curve keyed on normalised position t = i / (count - 1).
// progression='easy_to_hard': easy(t<0.25) → medium(t<0.60) → hard(t<0.85) → boss(t≥0.85)
// progression='flat_medium' : all medium except boss slots
// progression='flat_hard'   : all hard except boss slots
// progression='boss_rush'   : all hard/boss with boss at 40%+
function _difficultySequence(count, progression) {
  return Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 1 : i / (count - 1);
    switch (progression) {
      case 'flat_medium': return 'medium';
      case 'flat_hard':   return 'hard';
      case 'boss_rush':   return t >= 0.4 ? 'boss' : 'hard';
      case 'easy_to_hard':
      default:
        if (t < 0.25) return 'easy';
        if (t < 0.60) return 'medium';
        if (t < 0.85) return 'hard';
        return 'boss';
    }
  });
}

// Type assignment rules:
//   slot 0   → hub (if 'hub' in zoneTypes, else first available)
//   last slot → boss (if 'boss' in zoneTypes and count ≥ 2)
//   middle    → forest fills ~35% of middle slots (rounded), dungeons fill rest
function _typeSequence(count, zoneTypes, rng) {
  const hasHub   = zoneTypes.includes('hub');
  const hasBoss  = zoneTypes.includes('boss');
  const hasForest = zoneTypes.includes('forest');
  const hasDungeon = zoneTypes.includes('dungeon');

  const types = new Array(count);

  // Anchor slots
  if (hasHub)              types[0]         = 'hub';
  if (hasBoss && count >= 2) types[count - 1] = 'boss';

  // Fill middle
  const midStart = hasHub            ? 1         : 0;
  const midEnd   = hasBoss && count >= 2 ? count - 1 : count;
  const midCount = midEnd - midStart;

  const forestCount = (hasForest && hasDungeon)
    ? Math.round(midCount * 0.35)
    : hasForest ? midCount : 0;

  // Build shuffled middle sequence
  const mid = [
    ...Array(forestCount).fill('forest'),
    ...Array(midCount - forestCount).fill(hasDungeon ? 'dungeon' : (zoneTypes[0] ?? 'dungeon')),
  ];
  // Fisher-Yates shuffle using planner RNG
  for (let j = mid.length - 1; j > 0; j--) {
    const k = rng.nextInt(0, j);
    [mid[j], mid[k]] = [mid[k], mid[j]];
  }

  for (let i = midStart; i < midEnd; i++) types[i] = mid[i - midStart];

  // Fallback: fill any unset slots (edge case: count=1 without hub)
  for (let i = 0; i < count; i++) {
    if (!types[i]) types[i] = zoneTypes[0] ?? 'dungeon';
  }

  return types;
}

// ── Per-zone input builder ────────────────────────────────────────────────────

const TYPE_TO_THEME = {
  hub:     'hub',
  forest:  'forest',
  dungeon: 'dungeon',
  boss:    'dungeon',  // boss zones use dungeon template
};

const TYPE_TO_STRUCTURE = {
  hub:     'spine',
  forest:  'open',
  dungeon: 'maze',
  boss:    'maze',
};

const TYPE_TO_CONNECTIVITY = {
  hub:     'moderate',
  forest:  'simple',
  dungeon: 'moderate',
  boss:    'complex',
};

const DIFFICULTY_SIZE = {
  easy:   'medium',
  medium: 'large',
  hard:   'large',
  boss:   'large',
};

function _buildInput(index, typeKey, difficulty, safeName, plannerSeed, targetZone) {
  const zoneSeed     = ((plannerSeed ^ ((index + 1) * 0x9E3779B9)) >>> 0);
  const zoneName     = `${safeName}_${typeKey}_${index + 1}`;
  const specialRooms = _specialRooms(typeKey, difficulty);

  const input = {
    name:          zoneName,
    theme:         TYPE_TO_THEME[typeKey]  ?? 'dungeon',
    difficulty,
    seed:          zoneSeed,
    layoutIntent:  {
      size:         DIFFICULTY_SIZE[difficulty] ?? 'large',
      structure:    TYPE_TO_STRUCTURE[typeKey]  ?? 'maze',
      connectivity: TYPE_TO_CONNECTIVITY[typeKey] ?? 'moderate',
    },
    gameplayIntent: {
      enemies:      _enemyDensity(typeKey, difficulty),
      locks:        typeKey === 'dungeon' || typeKey === 'boss',
      specialRooms,
      hasPortal:    true,
    },
  };

  if (targetZone != null) input.targetZone = targetZone;
  return input;
}

function _specialRooms(typeKey, difficulty) {
  const rooms = [];
  if (typeKey === 'boss')                                          rooms.push('boss');
  if (typeKey === 'dungeon' && difficulty === 'hard')             rooms.push('hidden');
  if (typeKey === 'dungeon' && (difficulty === 'medium' || difficulty === 'hard')) rooms.push('treasure');
  return rooms;
}

function _enemyDensity(typeKey, difficulty) {
  if (typeKey === 'hub')    return 'sparse';
  if (typeKey === 'boss')   return 'dense';
  if (difficulty === 'easy') return 'sparse';
  if (difficulty === 'hard' || difficulty === 'boss') return 'dense';
  return 'moderate';
}

// ── Logging ───────────────────────────────────────────────────────────────────

function _logPlan(theme, count, progression, plannerSeed, inputs) {
  console.group(`[Planner] "${theme}" — ${count} zones, progression=${progression}, seed=${plannerSeed}`);
  console.log(
    inputs.map((inp, i) =>
      `  ${String(i + 1).padStart(2)}. ${inp.name.padEnd(35)} ` +
      `type=${inp.theme.padEnd(8)} difficulty=${inp.difficulty.padEnd(6)} ` +
      `size=${inp.layoutIntent.size.padEnd(7)} ` +
      (inp.gameplayIntent.specialRooms.length
        ? `special=[${inp.gameplayIntent.specialRooms.join(',')}]`
        : ''),
    ).join('\n'),
  );
  const sequence = inputs.map(inp => {
    const type = inp.theme === 'hub' ? 'hub' : inp.theme;
    return `${type}(${inp.difficulty})`;
  }).join(' → ');
  console.log(`[Planner] Sequence: ${sequence}`);
  console.groupEnd();
}

// ── Utility ───────────────────────────────────────────────────────────────────

// FNV-1a 32-bit hash — matches aiZoneInterpreter for cross-module consistency.
function _hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h  = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
