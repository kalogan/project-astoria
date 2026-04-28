// soundRegistry.js — maps every sound ID to its asset path + playback config.
//
// Sound ID format:  category.name
// cooldownMs:       minimum ms between plays of the same sound (spam guard)
// volume:           0–1 relative to master; layered on top of AudioSystem master gain
//
// File paths are relative to the web root.  Swap placeholder paths for real
// assets without touching any other file.

/** @type {Record<string, { src: string, cooldownMs: number, volume: number }>} */
export const SOUND_REGISTRY = {

  // ── Combat ────────────────────────────────────────────────────────────────
  // attack.wav   — sword swing / ability activation (player side)
  // hit.wav      — impact thud when something takes damage
  // enemy_hit    — lighter impact for enemy-received hit (keeps combat readable)
  // death.wav    — heavier finalising sound when an entity dies
  'combat.attack':   { src: '/assets/sfx/attack.wav',    cooldownMs:  80, volume: 0.70 },
  'combat.hit':      { src: '/assets/sfx/hit.wav',       cooldownMs: 100, volume: 0.80 },
  'combat.enemyHit': { src: '/assets/sfx/enemy_hit.wav', cooldownMs:  80, volume: 0.60 },
  'combat.death':    { src: '/assets/sfx/death.wav',     cooldownMs: 200, volume: 0.90 },

  // ── UI ────────────────────────────────────────────────────────────────────
  // click.wav   — generic menu / button press
  // confirm.wav — heavier "locked in" confirmation (skill unlock, quest accept)
  'ui.click':   { src: '/assets/sfx/click.wav',   cooldownMs:  50, volume: 0.50 },
  'ui.confirm': { src: '/assets/sfx/confirm.wav', cooldownMs: 150, volume: 0.70 },

  // ── Interaction ───────────────────────────────────────────────────────────
  // teleport.wav — whoosh / portal shimmer
  // altar.wav    — deep ritual chime
  'interaction.teleport': { src: '/assets/sfx/teleport.wav', cooldownMs: 500, volume: 0.80 },
  'interaction.altar':    { src: '/assets/sfx/altar.wav',    cooldownMs: 300, volume: 0.70 },

  // ── Rewards ───────────────────────────────────────────────────────────────
  // jewel.wav    — crystalline pickup chime (clan jewel claimed)
  // complete.wav — triumphant fanfare sting (dungeon / pentagram complete)
  'reward.jewel':    { src: '/assets/sfx/jewel.wav',    cooldownMs: 500, volume: 1.00 },
  'reward.complete': { src: '/assets/sfx/complete.wav', cooldownMs: 500, volume: 1.00 },

  // ── Movement ──────────────────────────────────────────────────────────────
  // step.wav — soft footstep; played on a timed interval, not per-pixel
  'movement.step': { src: '/assets/sfx/step.wav', cooldownMs: 300, volume: 0.25 },
};

/** All registered sound IDs — useful for debug / test-play loops. */
export const ALL_SOUND_IDS = Object.keys(SOUND_REGISTRY);

/**
 * Return the definition for a sound ID, or null if unknown.
 * @param {string} id
 */
export function getSoundDef(id) {
  return SOUND_REGISTRY[id] ?? null;
}
