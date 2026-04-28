// Zone templates — define WHAT a zone is, not HOW it's identified.
// Template is separate from config (id/seed/dimensions) so the same template
// can be applied to any config, and the same config can produce different zones
// by swapping the template.
//
// rules:    drive the layout algorithm (density, branching, loop frequency)
// entities: control which entity types are placed and at what probability

const _template = (type, layout, rules, entities) => ({ type, layout, rules, entities });

export const TEMPLATES = {

  // ── starter_hub ───────────────────────────────────────────────
  // Spine layout: wide central road, branching side corridors, open hub room.
  // Few enemies, no locked doors — intended as an orientation zone.
  starter_hub: _template('hub', 'spine', {
    enemyDensity:    0.015, // ~2-4 enemies on a 40×40 zone
    branchingFactor: 0.75,  // 0–1 → maps to 2–5 max branches
    deadEnds:        true,
    loops:           false,
    loopFactor:      0,
    obstacleDensity: 0,
  }, {
    enemyTypes: ['basic'],
    hasDoors:   false,
    hasKeys:    false,
    hasPortals: true,
    lockChance: 0,
  }),

  // ── forest ────────────────────────────────────────────────────
  // Field layout: open floor with scattered wall clusters, road cross for
  // navigation. Moderate enemies, no locks.
  forest: _template('forest', 'field', {
    enemyDensity:    0.025,
    branchingFactor: 0,     // not used by field layout
    deadEnds:        false,
    loops:           true,
    loopFactor:      0,     // not used by field layout
    obstacleDensity: 0.10,  // 10% of area becomes wall obstacle clusters
  }, {
    enemyTypes: ['basic'],
    hasDoors:   false,
    hasKeys:    false,
    hasPortals: true,
    lockChance: 0,
  }),

  // ── dungeon ───────────────────────────────────────────────────
  // Maze layout: tight carved corridors, dead ends, deliberate loops.
  // High enemy density, locked doors behind which keys must be found.
  dungeon: _template('dungeon', 'maze', {
    enemyDensity:    0.045,
    branchingFactor: 0,     // not used by maze layout
    deadEnds:        true,
    loops:           true,
    loopFactor:      0.20,  // fraction of maze cells that get an extra opening
    obstacleDensity: 0,
  }, {
    enemyTypes: ['basic'],
    hasDoors:   true,
    hasKeys:    true,
    hasPortals: true,
    lockChance: 0.85,       // 85% chance of placing a lock pair when hasDoors=true
  }),

};

export const DEFAULT_TEMPLATE = TEMPLATES.dungeon;

export function getTemplate(name) {
  return TEMPLATES[name] ?? null;
}

export function templateNames() {
  return Object.keys(TEMPLATES);
}
