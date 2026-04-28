// lightingPresets.js — ready-to-apply lighting environment presets.
//
// Each preset describes:
//   ambient  — base fill color + intensity (0-1)
//   lights   — array of light descriptors to scatter around the map
//   darkAlpha — how dark the base darkness layer is (0-1)
//
// These are applied via applyLightingPreset(zone, presetId) which writes
// zone.lightingPreset and optionally seeds zone.lights.

export const LIGHTING_PRESETS = {
  tavern_warm: {
    id:    'tavern_warm',
    label: 'Tavern Warm',
    emoji: '🍺',
    ambient:       { color: '#2a1a0f', intensity: 0.25 },
    darkAlpha:     0.72,
    shadowStrength: 0.6,
    contrast:      1.1,
    sampleLight: {
      type:         'torch',
      color:        { r: 255, g: 180, b: 106 },
      radius:       160,
      intensity:    1.0,
      flicker:      true,
      flickerSpeed: 1.2,
    },
  },

  dungeon_dark: {
    id:    'dungeon_dark',
    label: 'Dungeon Dark',
    emoji: '💀',
    ambient:       { color: '#0c0c12', intensity: 0.1 },
    darkAlpha:     0.92,
    shadowStrength: 0.9,
    contrast:      1.3,
    sampleLight: {
      type:         'torch',
      color:        { r: 255, g: 122, b: 58 },
      radius:       130,
      intensity:    0.9,
      flicker:      true,
      flickerSpeed: 1.5,
    },
  },

  cave_moody: {
    id:    'cave_moody',
    label: 'Cave Moody',
    emoji: '🪨',
    ambient:       { color: '#101820', intensity: 0.15 },
    darkAlpha:     0.88,
    shadowStrength: 0.85,
    contrast:      1.2,
    sampleLight: {
      type:         'crystal',
      color:        { r: 136, g: 170, b: 255 },
      radius:       180,
      intensity:    0.6,
      flicker:      false,
      flickerSpeed: 0,
    },
  },

  forest_day: {
    id:    'forest_day',
    label: 'Forest Day',
    emoji: '🌲',
    ambient:       { color: '#6fa86f', intensity: 0.6 },
    darkAlpha:     0.08,
    shadowStrength: 0.3,
    contrast:      0.95,
    sampleLight:   null,
  },

  forest_night: {
    id:    'forest_night',
    label: 'Forest Night',
    emoji: '🌙',
    ambient:       { color: '#0f1a2e', intensity: 0.2 },
    darkAlpha:     0.82,
    shadowStrength: 0.8,
    contrast:      1.2,
    sampleLight: {
      type:         'ambient',
      color:        { r: 168, g: 199, b: 255 },
      radius:       300,
      intensity:    0.5,
      flicker:      false,
      flickerSpeed: 0,
    },
  },

  mage_arcane: {
    id:    'mage_arcane',
    label: 'Mage Arcane',
    emoji: '🔮',
    ambient:       { color: '#1a0f2a', intensity: 0.3 },
    darkAlpha:     0.78,
    shadowStrength: 0.7,
    contrast:      1.15,
    sampleLight: {
      type:         'magic',
      color:        { r: 195, g: 154, b: 240 },
      radius:       165,
      intensity:    0.8,
      flicker:      true,
      flickerSpeed: 0.8,
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Apply a preset's darkAlpha override when lighting is on. */
export function presetDarkAlpha(presetId) {
  return LIGHTING_PRESETS[presetId]?.darkAlpha ?? 0.78;
}

/** Return the sample light descriptor for a preset (or null if none). */
export function presetSampleLight(presetId) {
  return LIGHTING_PRESETS[presetId]?.sampleLight ?? null;
}
