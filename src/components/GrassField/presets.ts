// ─────────────────────────────────────────────────────────────────────────────
// Grass presets.
//
// A preset is a partial set of Leva values: it names only what it changes, and
// applying one pushes those values into the panel, where they stay editable.
//
// That means presets must be applied on top of a known baseline, not on top of
// whatever the previous preset left behind — otherwise switching A → B → A gives
// you a different look the second time, since B's fields would linger wherever A
// doesn't mention them. GrassField handles this by resetting to `default` before
// applying any other preset, so a preset only has to declare its own deltas.
//
// Only params that are live UNIFORMS belong here. Anything marked "(rebuilds)"
// in the panel would respawn every instance on each switch.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrassPreset {
  label: string;
  values: Record<string, string | number | boolean>;
}

export const GRASS_PRESETS: Record<string, GrassPreset> = {
  default: {
    label: "Spring",
    values: {
      // Color
      grColorBottom: "#4f7c13",
      grColorTop: "#79a01c",
      // Ground
      grDirtColor: "#ac956c",
      grDirtCoverage: 0.41,
      grDirtScale: 0.4,
      grDirtSoftness: 0.06,
      grDirtCut: 1.0,
      grDirtBlend: 0.8,
      grGndVarColor: "#c4a77d",
      grGndVarStrength: 0.9,
      // Translucency
      grTransColor: "#c1e54d",
      grTransStrength: 2.5,
    },
  },

  autumn: {
    label: "Autumn",
    values: {
      // Dry, yellowed grass...
      grColorBottom: "#7e8005",
      grColorTop: "#d2db18",
      // ...over more, sandier earth showing through. The lower Cut leaves short
      // stubble on the patches instead of clearing them, which reads as parched
      // rather than bare.
      grDirtColor: "#e2b329",
      grDirtCoverage: 0.48,
      grDirtScale: 0.26,
      grDirtSoftness: 0.11,
      grDirtCut: 0.7,
      grDirtBlend: 1,
      grGndVarColor: "#ffc866",
      grGndVarStrength: 0.9,
      // Strong golden backlight — the late-afternoon look.
      grTransColor: "#f8f454",
      grTransStrength: 3,
    },
  },
};

export type GrassPresetKey = keyof typeof GRASS_PRESETS;
