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
// Most values here are live uniforms, so switching is instant. A preset MAY
// touch a "(rebuilds)" param (blade width/length), which respawns the instanced
// meshes on that switch — the Mars preset does, because its spiky blades are
// part of the look. Just don't put per-frame-ish params behind one.
//
// Whatever a preset changes, `default` must also declare — that's what a switch
// back resets to.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrassPreset {
  label: string;
  values: Record<string, string | number | boolean>;
}

export const GRASS_PRESETS: Record<string, GrassPreset> = {
  // The baseline. It must name every field any other preset touches, since this
  // is what a switch resets to.
  default: {
    label: "Spring",
    values: {
      // Blades (rebuilds)
      grMinWidth: 0.06,
      grMaxWidth: 0.06,
      grMinLength: 0.15,
      grMaxLength: 0.25,
      // Color
      grColorBottom: "#4f7c13",
      grColorTop: "#79a01c",
      grGradStart: 0.15,
      grGradEnd: 1.0,
      grBrightness: 0.8,
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
      // Wind
      grWindStrength: 0.1,
      grWindSpeed: 1.3,
      // Pine leaves
      grLeafBottom: "#1c3b23",
      grLeafTop: "#5c8338",
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
      // Turning canopies: amber inside, burning red at the outer needles. The
      // gradient runs bottom → top of each canopy, so the ramp lands where the
      // light hits — the tree looks like it's changing from the outside in.
      grLeafBottom: "#ffaf36",
      grLeafTop: "#ff1910",
    },
  },

  mars: {
    label: "Mars",
    values: {
      // Longer, spikier blades. Note min > max on the width: the scatter reads
      // this as a range either way (width = min + rng·(max − min)), so it just
      // runs 0.025 → 0.08 — a wider spread than the uniform 0.06 of the others,
      // which is what gives the field its ragged, alien silhouette.
      grMinWidth: 0.08,
      grMaxWidth: 0.025,
      grMinLength: 0.24,
      grMaxLength: 0.4,
      // Rust base burning into hot pink at the tips. The gradient ends early
      // (0.75) so the pink saturates well before the tip instead of easing in.
      grColorBottom: "#c7611a",
      grColorTop: "#f879e7",
      grGradStart: 0.14,
      grGradEnd: 0.75,
      grBrightness: 0.9,
      // Cyan soil under violet mottling — the complementary pairing is what
      // makes the pink read as alien rather than merely floral.
      grDirtColor: "#66cde5",
      grDirtCoverage: 0.44,
      grDirtScale: 0.28,
      grDirtSoftness: 0.13,
      grGndVarColor: "#8386ff",
      // White backlight, so the blades glow rather than tint.
      grTransColor: "#ffffff",
      grTransStrength: 2.5,
      // Thin, fast wind — a colder, sharper atmosphere.
      grWindStrength: 0.081,
      grWindSpeed: 2.2,
      // Canopies take the same rust→pink ramp as the grass.
      grLeafBottom: "#c7611a",
      grLeafTop: "#f879e7",
    },
  },
};

export type GrassPresetKey = keyof typeof GRASS_PRESETS;
