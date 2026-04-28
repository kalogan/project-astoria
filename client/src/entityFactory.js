// entityFactory.js — converts editor entity data into runtime-ready def objects.
//
// The editor stores entities in zone.entities with this shape:
//   { id, type, subtype, position: { x, y }, facing: string, config: object }
//
// This factory is the single authoritative place that maps editor data →
// the def format expected by NPC / Enemy constructors and zoneManager.
//
// Rules:
//   • No Three.js imports — factory only builds plain JS objects (defs)
//   • No system references — construction stays in ZoneManager
//   • Subtype profiles live here; nowhere else hardcodes enemy stats

// ── Facing ────────────────────────────────────────────────────────────────────
// Editor stores a cardinal string; Three.js rotation.y expects radians.
// Angles are defined so that the NPC model faces the named direction
// relative to the isometric camera orientation used by the game.

const FACING_ANGLES = {
  north:  0,
  south:  Math.PI,
  east:  -Math.PI / 2,
  west:   Math.PI / 2,
};

function normaliseFacing(facing) {
  if (typeof facing === 'number') return facing;           // legacy numeric value
  return FACING_ANGLES[facing] ?? 0;                      // editor string → radians
}

// ── NPC visual profiles ───────────────────────────────────────────────────────
// Color drives the Three.js material used by the NPC mesh (body + head + staff).
// When a full sprite/model system arrives, swap color for a modelId lookup here.

const NPC_PROFILES = {
  greeter:  { color: 0x4fc38a },   // soft green — approachable
  merchant: { color: 0xf5c842 },   // gold — prosperous
};

// ── Enemy stat profiles ───────────────────────────────────────────────────────
// Each profile defines the BASE (level 1) stats for that enemy subtype.
// hp and attackDamage scale with entity.config.level using the formulae below.

const ENEMY_PROFILES = {
  slime: {
    color:        0x4caf50,
    hp:           60,
    speed:        1.8,
    attackDamage: 6,
    xpValue:      8,
    type:         'melee',
  },
  skeleton: {
    color:        0xc8c8c8,
    hp:           100,
    speed:        2.2,
    attackDamage: 12,
    xpValue:      15,
    type:         'melee',
  },
};

const DEFAULT_ENEMY_PROFILE = ENEMY_PROFILES.slime;

// Level scaling coefficients (compound growth per level above 1)
const HP_SCALE_PER_LEVEL     = 0.25;   // +25% HP per level
const DMG_SCALE_PER_LEVEL    = 0.20;   // +20% attack damage per level

// ── EntityFactory ─────────────────────────────────────────────────────────────

export class EntityFactory {

  /**
   * Build an NPC def from an editor entity.
   * Output matches the shape expected by the NPC constructor in entities.js:
   *   { id, type, x, z, name, color, facing, dialogueId, subtype }
   *
   * Works for both editor-placed entities (facing = string, no color)
   * and legacy zone entities (facing = number, color = hex number).
   */
  static buildNpcDef(entity) {
    const profile = NPC_PROFILES[entity.subtype] ?? {};
    return {
      // ── Core identity ──────────────────────────────────────────────────
      id:      entity.id,
      type:    'npc',
      subtype: entity.subtype ?? null,

      // ── World position (zone format: position.y = world Z) ─────────────
      x: entity.position.x,
      z: entity.position.y,

      // ── Visual ────────────────────────────────────────────────────────
      // Prefer profile color so subtypes look distinct.
      // Fall back to the legacy inline color or the neutral default.
      color:  profile.color
           ?? (typeof entity.color === 'number' ? entity.color : null)
           ?? 0xd4a96a,

      // ── Facing ────────────────────────────────────────────────────────
      facing: normaliseFacing(entity.facing),

      // ── Display name ──────────────────────────────────────────────────
      name: entity.config?.name
         ?? entity.name           // legacy field
         ?? entity.subtype
         ?? entity.id,

      // ── Dialogue component ─────────────────────────────────────────────
      // Stored on the NPC instance; consumed by a dialogue system when one exists.
      // config.dialogue is the key the editor writes; dialogueId is the runtime field.
      dialogueId: entity.config?.dialogue ?? entity.dialogueId ?? null,

      // ── Interaction component ──────────────────────────────────────────
      // Marks this NPC as player-interactable.  The entity manager and future
      // dialogue system check this flag before processing proximity events.
      interactable: true,
    };
  }

  /**
   * Build an Enemy def from an editor entity.
   * Output matches the shape expected by the Enemy constructor in enemySystem.js:
   *   { id, x, z, color, hp, speed, attackDamage, xpValue, type, subtype }
   *
   * Stats are looked up from ENEMY_PROFILES[subtype] and scaled by
   * entity.config.level (default level 1).
   */
  static buildEnemyDef(entity) {
    const profile = ENEMY_PROFILES[entity.subtype] ?? DEFAULT_ENEMY_PROFILE;
    const level   = Number(entity.config?.level ?? 1);

    // Compound growth:  baseStat × (1 + coefficient × (level - 1))
    const hp           = Math.round(profile.hp           * (1 + HP_SCALE_PER_LEVEL  * (level - 1)));
    const attackDamage = Math.round(profile.attackDamage * (1 + DMG_SCALE_PER_LEVEL * (level - 1)));

    return {
      // ── Core identity ──────────────────────────────────────────────────
      id:      entity.id,
      subtype: entity.subtype ?? null,

      // ── World position ─────────────────────────────────────────────────
      x: entity.position.x,
      z: entity.position.y,

      // ── Combat stats ──────────────────────────────────────────────────
      hp,
      attackDamage,
      speed:   profile.speed,
      xpValue: profile.xpValue,
      color:   profile.color,
      type:    profile.type,
    };
  }

  /**
   * Extract a world-space spawn position from an editor spawn entity.
   * Returns { x, z } which is the format used by ZoneManager.load().
   */
  static buildSpawnDef(entity) {
    return {
      x: entity.position.x,
      z: entity.position.y,  // zone format: position.y = world Z
    };
  }
}
