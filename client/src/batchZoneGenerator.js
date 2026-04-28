// Batch zone generator — generates multiple zones from AI-style input arrays
// and stores them in memory without immediately loading them into the scene.
//
// Pipeline per zone: interpretAIInput → generateZone → _batchZones
//
// Debug shortcuts (exposed via window.__debug.batch):
//   __debug.batch.example()          — generate EXAMPLE_BATCH (5 zones)
//   __debug.batch.gen1()             — generate the first example zone
//   __debug.batch.gen5()             — generate first 5 zones
//   __debug.batch.gen20()            — generate 20 zones from repeated examples
//   __debug.batch.load('zone_id')    — load a batch zone into the active scene
//   __debug.batch.list()             — list all stored zone ids
//   __debug.batch.clear()            — clear stored zones

import { interpretAIInput } from './aiZoneInterpreter.js';
import { generateZone }     from './zoneGenerator.js';
import { enrichZone }       from './contentGenerator.js';

// narrativeRole by zone theme — used to pass context to contentGenerator
const THEME_TO_ROLE = {
  hub:     'start',
  forest:  'progression',
  dungeon: 'challenge',
  boss:    'climax',
};

// Internal store: zoneId → { zone, config, template, constraints }
const _batchZones = new Map();

// ── Example batch ─────────────────────────────────────────────────────────────
// 5 representative zones: easy forest, two medium dungeons, hard boss dungeon, hub.

export const EXAMPLE_BATCH = [
  {
    name:          'easy_forest_1',
    theme:         'forest',
    difficulty:    'easy',
    layoutIntent:  { size: 'medium', structure: 'open', connectivity: 'simple' },
    gameplayIntent:{ enemies: 'sparse', locks: false, specialRooms: [], hasPortal: true },
  },
  {
    name:          'medium_dungeon_1',
    theme:         'dungeon',
    difficulty:    'medium',
    layoutIntent:  { size: 'large', structure: 'maze', connectivity: 'moderate' },
    gameplayIntent:{ enemies: 'moderate', locks: true, specialRooms: ['hidden'], hasPortal: true },
  },
  {
    name:          'medium_dungeon_2',
    theme:         'dungeon',
    difficulty:    'medium',
    layoutIntent:  { size: 'large', structure: 'maze', connectivity: 'complex' },
    gameplayIntent:{ enemies: 'moderate', locks: true, specialRooms: ['treasure'], hasPortal: true },
  },
  {
    name:          'hard_boss_dungeon',
    theme:         'dungeon',
    difficulty:    'boss',
    layoutIntent:  { size: 'large', structure: 'maze', connectivity: 'complex' },
    gameplayIntent:{ enemies: 'dense', locks: true, specialRooms: ['boss', 'hidden'], hasPortal: true },
  },
  {
    name:          'hub_zone',
    theme:         'hub',
    difficulty:    'easy',
    layoutIntent:  { size: 'large', structure: 'spine', connectivity: 'moderate' },
    gameplayIntent:{ enemies: 'sparse', locks: false, specialRooms: [], hasPortal: true },
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

// Generate zones from an array of AI input objects.
// Zones are stored internally; none are loaded into the scene.
// Returns { succeeded: string[], failed: Array<{zoneId, error}> }
export function generateZoneBatch(inputs) {
  if (!inputs?.length) {
    console.warn('[Batch] No inputs provided');
    return { succeeded: [], failed: [] };
  }

  const succeeded = [];
  const failed    = [];

  console.group(`[Batch] Generating ${inputs.length} zone(s)…`);

  for (let i = 0; i < inputs.length; i++) {
    const input  = inputs[i];
    const zoneId = input.name ?? `zone_${i}`;

    if (_batchZones.has(zoneId)) {
      console.warn(`[Batch] (${i + 1}/${inputs.length}) "${zoneId}" — duplicate id, overwriting`);
    } else {
      console.log(`[Batch] (${i + 1}/${inputs.length}) "${zoneId}"`);
    }

    try {
      const { config, template, constraints } = interpretAIInput(input, i);
      const zone = generateZone(config, template, constraints);

      // Enrich layout with typed enemies, quests, loot tables, behaviors
      enrichZone(zone, {
        zoneType:      input.theme      ?? 'dungeon',
        difficulty:    input.difficulty ?? 'medium',
        narrativeRole: THEME_TO_ROLE[input.theme] ?? null,
        seed:          config.seed,
      });

      _batchZones.set(zone.id, { zone, config, template, constraints });
      succeeded.push(zone.id);

      console.log(
        `[Batch] ✓ "${zone.id}"`,
        `enemies=${zone.systems.enemies.length}`,
        `keys=${zone.systems.keys.length}`,
        `doors=${zone.systems.doors.length}`,
        `[${zone.config.width}×${zone.config.height} seed=${zone.config.seed}]`,
      );
    } catch (err) {
      failed.push({ zoneId, error: err.message });
      console.error(`[Batch] ✗ "${zoneId}" —`, err.message);
    }
  }

  console.log(
    `[Batch] Done — ${succeeded.length} succeeded, ${failed.length} failed.`,
    `Total stored: ${_batchZones.size}`,
  );
  console.groupEnd();

  return { succeeded, failed };
}

// Retrieve a single batch entry by id.
// Returns { zone, config, template, constraints } or null.
export function getBatchZone(zoneId) {
  return _batchZones.get(zoneId) ?? null;
}

// Returns a plain-object snapshot matching the spec: { zoneId: zoneData }
export function getBatchZonesSnapshot() {
  const out = {};
  for (const [id, entry] of _batchZones) out[id] = entry.zone;
  return out;
}

// Returns an array of all stored zone ids.
export function listBatchZones() {
  return [..._batchZones.keys()];
}

// Empties the batch store.
export function clearBatch() {
  const count = _batchZones.size;
  _batchZones.clear();
  console.log(`[Batch] Cleared ${count} zone(s)`);
}

// Load a stored batch zone into the active scene via ZoneManager.
// zoneManager must be the live ZoneManager instance from main.js.
export async function loadZoneFromBatch(zoneId, zoneManager) {
  const entry = _batchZones.get(zoneId);
  if (!entry) {
    console.warn(`[Batch] "${zoneId}" not found — call generateZoneBatch first`);
    return false;
  }
  const { zone, config, template, constraints } = entry;
  await zoneManager.loadPregenZone(zone, { config, template, constraints });
  return true;
}

// ── Quick-generation helpers (used by debug shortcuts) ────────────────────────

// Generate N zones by cycling through EXAMPLE_BATCH with unique name suffixes.
export function generateBatchN(n) {
  const inputs = Array.from({ length: n }, (_, i) => {
    const base = EXAMPLE_BATCH[i % EXAMPLE_BATCH.length];
    const cycle = Math.floor(i / EXAMPLE_BATCH.length);
    return { ...base, name: cycle === 0 ? base.name : `${base.name}_${cycle}` };
  });
  return generateZoneBatch(inputs);
}
