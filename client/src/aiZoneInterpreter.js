// AI zone interpreter — translates semantic input objects into the technical
// { config, template, constraints } triple consumed by generateZone.
//
// Inputs are intentionally human/AI-readable; this module owns the mapping.
// Seed derivation: explicit seed > FNV hash of name > index-based constant.

import { TEMPLATES, DEFAULT_TEMPLATE } from './zoneTemplates.js';

// ── Mapping tables ────────────────────────────────────────────────────────────

const THEME_TO_TEMPLATE = {
  dungeon: TEMPLATES.dungeon,
  forest:  TEMPLATES.forest,
  hub:     TEMPLATES.starter_hub,
};

const DIFFICULTY_ENEMIES = {
  easy:   { min: 2, max: 4  },
  medium: { min: 4, max: 8  },
  hard:   { min: 7, max: 12 },
  boss:   { min: 9, max: 12 },
};

const SIZE_DIMS = {
  small:  [20, 20],
  medium: [30, 30],
  large:  [40, 40],
};

// Maps connectivity → minimum room-area count (null = no constraint)
const CONNECTIVITY_ROOMS = {
  simple:   null,
  moderate: 2,
  complex:  4,
};

// ── Public API ────────────────────────────────────────────────────────────────

// Returns { config, template, constraints } from a single AI input object.
// index is used as a fallback seed when neither input.seed nor input.name is set.
export function interpretAIInput(input, index = 0) {
  const {
    name,
    theme         = 'dungeon',
    difficulty    = 'medium',
    seed,
    layoutIntent  = {},
    gameplayIntent = {},
    targetZone,
    returnSpawnX,
    returnSpawnZ,
  } = input;

  const template = THEME_TO_TEMPLATE[theme] ?? DEFAULT_TEMPLATE;
  const [w, h]   = SIZE_DIMS[layoutIntent.size ?? 'medium'] ?? SIZE_DIMS.medium;
  const enemies  = DIFFICULTY_ENEMIES[difficulty] ?? DIFFICULTY_ENEMIES.medium;
  const rooms    = CONNECTIVITY_ROOMS[layoutIntent.connectivity ?? 'moderate'] ?? null;

  // Deterministic seed: explicit > FNV name hash > index-derived constant
  const resolvedSeed =
    seed != null    ? (seed >>> 0) :
    name            ? _hashStr(name) :
                      ((index * 0x9E3779B9) >>> 0);

  const config = {
    id:     name ?? `zone_${index}`,
    width:  w,
    height: h,
    seed:   resolvedSeed,
    ...(targetZone != null
      ? { targetZone, returnSpawnX: returnSpawnX ?? 0, returnSpawnZ: returnSpawnZ ?? 0 }
      : {}),
  };

  const specialRooms  = gameplayIntent.specialRooms ?? [];
  const lockRequested = gameplayIntent.locks ?? template.entities.hasDoors;
  const lockCount     = (difficulty === 'hard' || difficulty === 'boss') ? 2 : 1;

  const constraints = {
    minEnemies:      enemies.min,
    maxEnemies:      enemies.max,
    requiredRooms:   rooms,
    hasBossRoom:     difficulty === 'boss' || specialRooms.includes('boss'),
    hasHiddenArea:   specialRooms.includes('hidden'),
    hasTreasureRoom: specialRooms.includes('treasure'),
    ...(lockRequested ? { requiredKeys: lockCount, requiredDoors: lockCount } : {}),
  };

  return { config, template, constraints };
}

// ── Utility ───────────────────────────────────────────────────────────────────

// FNV-1a 32-bit hash — deterministic, good distribution, no randomness.
function _hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h  = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
