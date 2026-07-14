import { useControls, folder } from "leva";

// ─────────────────────────────────────────────────────────────────────────────
// Leva controls for <GrassField />.
//
// Everything here is a live uniform EXCEPT the params labelled "(rebuilds)".
// Those change instance GEOMETRY — how many blades/flowers there are and how big
// they are — so they respawn the InstancedMeshes. Colors, wind, dirt, trampling
// and translucency never rebuild anything and are free to drag around.
//
// The defaults are tuned for the demo GLB, whose grass surface is ~14.8 × 14.8
// world units (≈ 218 u²). Density is per u², so 300 → ~53k blades. If you plug
// in your own model, density and blade length are the first two to revisit.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns `[values, set]` — the functional form, so presets can push values back
 *  into the panel (see presets.ts). */
export function useGrassControls() {
  return useControls(
    "Grass",
    () => ({
      Blades: folder(
        {
          grDensity: {
            value: 300,
            min: 1,
            max: 300,
            step: 1,
            label: "Density (blades/u² — rebuilds)",
          },
          grMaxCount: {
            value: 53000,
            min: 100,
            max: 60000,
            step: 100,
            label: "Max Blades (rebuilds)",
          },
          grMinWidth: {
            value: 0.06,
            min: 0.005,
            max: 0.5,
            step: 0.005,
            label: "Min Width (rebuilds)",
          },
          grMaxWidth: {
            value: 0.06,
            min: 0.005,
            max: 0.5,
            step: 0.005,
            label: "Max Width (rebuilds)",
          },
          grMinLength: {
            value: 0.15,
            min: 0.02,
            max: 3,
            step: 0.01,
            label: "Min Length (rebuilds)",
          },
          grMaxLength: {
            value: 0.25,
            min: 0.02,
            max: 3,
            step: 0.01,
            label: "Max Length (rebuilds)",
          },
          grTiltMax: {
            value: 0.16,
            min: 0,
            max: 1.5,
            step: 0.01,
            label: "Max Tilt (rebuilds)",
          },
        },
        { collapsed: false },
      ),

      Color: folder(
        {
          grColorBottom: { value: "#4f7c13", label: "Color Bottom" },
          grColorTop: { value: "#79a01c", label: "Color Top" },
          // Gradient shaping — holding the bottom color near the ground is what
          // lets the blade bases melt into the terrain instead of banding.
          grGradStart: {
            value: 0.15,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Gradient Start (base)",
          },
          grGradEnd: {
            value: 1.0,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Gradient End (tip)",
          },
          grGradPower: {
            value: 1.6,
            min: 0.2,
            max: 6,
            step: 0.1,
            label: "Gradient Curve (>1 = more base)",
          },
          grBrightness: {
            value: 0.8,
            min: 0.01,
            max: 2,
            step: 0.05,
            label: "Brightness",
          },
          grShadowStrength: {
            value: 1,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Shadow Strength",
          },
          // One shadow sample per blade instead of per fragment, so a blade is
          // never half-lit and the shadow edge follows the grass silhouette
          // instead of cutting a hard line across it.
          grPerBladeShadow: {
            value: 0.55,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Per-Blade Shadow",
          },
          grShadowSampleY: {
            value: 0.6,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Shadow Sample Height",
          },
          grTintFloor: { value: true, label: "Tint Ground To Match" },
          // Matches the ground's shading normal to the blades' (forced +Y), so
          // the same color lands on the same NdotL and the ground stops reading
          // as a different green than the blade bases.
          grFlatFloorNormal: {
            value: 1,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Flatten Ground Normal",
          },
        },
        { collapsed: true },
      ),

      // Procedural dirt patches painted on the ground. The blades sample the same
      // mask, so over dirt they shrink and take the earth color — the grass thins
      // out into the patch instead of ending at a line.
      Ground: folder(
        {
          grDirtColor: { value: "#ac956c", label: "Dirt Color" },
          grDirtCoverage: {
            value: 0.41,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Coverage (0 = off)",
          },
          grDirtScale: {
            value: 0.4,
            min: 0.01,
            max: 1,
            step: 0.01,
            label: "Patch Scale (bigger = smaller patches)",
          },
          grDirtSoftness: {
            value: 0.06,
            min: 0.01,
            max: 0.5,
            step: 0.01,
            label: "Edge Softness",
          },
          grDirtWarp: {
            value: 0.2,
            min: 0,
            max: 3,
            step: 0.05,
            label: "Warp (ragged edges)",
          },
          grDirtCut: {
            value: 1.0,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Blade Shortening On Dirt",
          },
          grDirtBlend: {
            value: 0.8,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Blade Color Blend",
          },
          // Texture + relief for the dirt itself. Weighted by the dirt mask, so
          // it never shows up under the grass (there the ground must stay exactly
          // the blades' bottom color).
          grGndVarColor: { value: "#c4a77d", label: "Variation Color" },
          grGndVarStrength: {
            value: 0.9,
            min: 0,
            max: 2,
            step: 0.05,
            label: "Variation Strength",
          },
          grGndVarScale: {
            value: 1.24,
            min: 0.01,
            max: 2,
            step: 0.01,
            label: "Variation Scale",
          },
          grGndGrainStrength: {
            value: 0.95,
            min: 0,
            max: 2,
            step: 0.05,
            label: "Grain Strength",
          },
          grGndGrainScale: {
            value: 6.7,
            min: 0.5,
            max: 20,
            step: 0.1,
            label: "Grain Scale",
          },
          grGndReliefStrength: {
            value: 0.0,
            min: 0,
            max: 4,
            step: 0.05,
            label: "Relief Strength (fake bumps)",
          },
          grGndReliefScale: {
            value: 0.05,
            min: 0.05,
            max: 4,
            step: 0.05,
            label: "Relief Scale",
          },
        },
        { collapsed: false },
      ),

      // Grass pressed down around the rocks. Each rock is fed to the shader as a
      // world-space sphere; the blades inside it are flattened and splayed.
      Trampling: folder(
        {
          grRockFlatten: {
            value: 1.0,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Flatten Under Rocks",
          },
          grRockBend: {
            value: 0.41,
            min: 0,
            max: 2,
            step: 0.01,
            label: "Bend Away",
          },
          grRockRadiusMul: {
            value: 0.2,
            min: 0.2,
            max: 3,
            step: 0.05,
            label: "Radius Multiplier",
          },
          grRockFalloff: {
            value: 0.35,
            min: 0.01,
            max: 3,
            step: 0.01,
            label: "Falloff (soft edge)",
          },
        },
        { collapsed: false },
      ),

      // Light passing through the blades — a warm glow on backlit grass. Driven
      // by the scene's directional light, which GrassField mirrors into uSunDir.
      Translucency: folder(
        {
          grTransColor: { value: "#c1e54d", label: "Color" },
          grTransStrength: {
            value: 2.5,
            min: 0,
            max: 3,
            step: 0.05,
            label: "Strength (0 = off)",
          },
          grTransPower: {
            value: 6.4,
            min: 0.5,
            max: 16,
            step: 0.1,
            label: "Falloff (higher = tighter)",
          },
          grTransTip: {
            value: 1.0,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Tip Bias (1 = tips only)",
          },
          grTransShadow: {
            value: 1,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Killed By Shadow",
          },
        },
        { collapsed: false },
      ),

      Wind: folder(
        {
          grWindStrength: {
            value: 0.1,
            min: 0,
            max: 0.25,
            step: 0.001,
            label: "Strength",
          },
          grWindSpeed: {
            value: 1.3,
            min: 0.1,
            max: 6,
            step: 0.05,
            label: "Speed",
          },
          grWindFreq: {
            value: 0.47,
            min: 0.05,
            max: 3,
            step: 0.025,
            label: "Frequency",
          },
          grWindDir: {
            value: 243,
            min: 0,
            max: 360,
            step: 1,
            label: "Direction °",
          },
          grWindTurb: {
            value: 0.04,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Turbulence",
          },
          grWindLean: {
            value: 0.05,
            min: 0,
            max: 3,
            step: 0.05,
            label: "Lean",
          },
        },
        { collapsed: true },
      ),

      // Trunks: the GLB's baked bark is replaced by the bark texture set
      // (color + AO + height), sampled live so scale/tint/relief are tweakable.
      "Trunk Bark": folder(
        {
          grBarkScale: {
            value: 5.6,
            min: 0.1,
            max: 20,
            step: 0.1,
            label: "Texture Scale",
          },
          grBarkTint: { value: "#8a6a4a", label: "Tint" },
          grBarkTintStrength: {
            value: 0,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Tint Strength",
          },
          grBarkSaturation: {
            value: 0.7,
            min: 0,
            max: 2,
            step: 0.05,
            label: "Saturation (0 = greyscale)",
          },
          grBarkBrightness: {
            value: 1.55,
            min: 0.1,
            max: 3,
            step: 0.05,
            label: "Brightness",
          },
          grBarkAOStrength: {
            value: 0.45,
            min: 0,
            max: 1,
            step: 0.05,
            label: "AO Strength",
          },
          grBarkRelief: {
            value: 1.5,
            min: 0,
            max: 10,
            step: 0.1,
            label: "Relief (height bump)",
          },
        },
        { collapsed: true },
      ),

      // Pine needles: the GLB's photographic leaf texture is kept only for its
      // alpha cut-out; the colors below replace its RGB entirely.
      "Pine Leaves": folder(
        {
          grLeafBottom: { value: "#1c3b23", label: "Color Bottom (inner)" },
          grLeafTop: { value: "#5c8338", label: "Color Top (outer)" },
          grLeafGradPower: {
            value: 1.1,
            min: 0.2,
            max: 6,
            step: 0.1,
            label: "Gradient Curve",
          },
          grLeafBrightness: {
            value: 1.05,
            min: 0.1,
            max: 3,
            step: 0.05,
            label: "Brightness",
          },
          grLeafVarColor: { value: "#1e4430", label: "Variation Color" },
          grLeafVarStrength: {
            value: 0.6,
            min: 0,
            max: 2,
            step: 0.05,
            label: "Variation Strength",
          },
          grLeafVarScale: {
            value: 2.5,
            min: 0.1,
            max: 20,
            step: 0.1,
            label: "Variation Scale",
          },
          // Direction, speed and frequency come from the Wind folder above — the
          // canopies answer to the same gust as the blades. Only the amplitude
          // and the flutter are leaf-specific.
          grLeafWindStrength: {
            value: 1.5,
            min: 0,
            max: 3,
            step: 0.01,
            label: "Wind Strength (0 = still)",
          },
          grLeafFlutterAmp: {
            value: 0.35,
            min: 0,
            max: 2,
            step: 0.05,
            label: "Flutter Amount",
          },
          grLeafFlutterSpeed: {
            value: 3.2,
            min: 0,
            max: 10,
            step: 0.1,
            label: "Flutter Speed",
          },
          grLeafDip: {
            value: 1.0,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Pendulum Dip",
          },
        },
        { collapsed: true },
      ),
    }),
    { collapsed: false },
  );
}

export function useFlowerControls() {
  return useControls(
    "Flowers",
    {
      flEnabled: { value: true, label: "Enabled (rebuilds)" },
      Scatter: folder(
        {
          flDensity: {
            value: 0.6,
            min: 0,
            max: 5,
            step: 0.05,
            label: "Density (rebuilds)",
          },
          flMaxCount: {
            value: 257,
            min: 1,
            max: 1000,
            step: 1,
            label: "Max Count (rebuilds)",
          },
          flSize: {
            value: 0.6,
            min: 0.05,
            max: 3,
            step: 0.05,
            label: "Size (rebuilds)",
          },
          flMixA: {
            value: 0.4,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Variant Mix (rebuilds)",
          },
          // Flowers grow in grass, not on bare earth. Culled in the shader
          // against the same dirt mask the ground paints, so this is live.
          flDirtMax: {
            value: 0.15,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Hide On Dirt (1 = never)",
          },
        },
        { collapsed: false },
      ),
      // The RGB map's dominant channel picks one of these slots per pixel; a
      // neutral pixel is a stem or leaf.
      Color: folder(
        {
          flColorR: { value: "#b084c7", label: "Color R" },
          flColorG: { value: "#cbb36a", label: "Color G" },
          flColorB: { value: "#9287ff", label: "Color B" },
          flColorStem: { value: "#648029", label: "Color Stems/Leaves" },
          flBrightness: {
            value: 1.0,
            min: 0,
            max: 3,
            step: 0.05,
            label: "Brightness",
          },
        },
        { collapsed: true },
      ),
      Wind: folder(
        {
          flWindStrength: {
            value: 0.15,
            min: 0,
            max: 2,
            step: 0.01,
            label: "Strength",
          },
          flWindSpeed: {
            value: 0.8,
            min: 0,
            max: 5,
            step: 0.05,
            label: "Speed",
          },
          flWindFreq: {
            value: 0.3,
            min: 0,
            max: 3,
            step: 0.01,
            label: "Frequency",
          },
          flWindTurb: {
            value: 0.2,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Turbulence",
          },
          flWindLean: {
            value: 0.25,
            min: 0,
            max: 2,
            step: 0.01,
            label: "Lean",
          },
          flBendAmp: {
            value: 0.2,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Bend Amplitude",
          },
          flBendFreq: {
            value: 3.0,
            min: 0,
            max: 20,
            step: 0.5,
            label: "Bend Frequency",
          },
        },
        { collapsed: true },
      ),
    },
    { collapsed: true },
  );
}

/** Transform of the whole field, plus a PBR override for the GLB's own meshes
 *  (rocks, and anything the field doesn't repaint) to flatten them out of their
 *  authored realistic look. */
export function useGrassSceneControls() {
  return useControls("Grass Scene", {
    Material: folder(
      {
        matOverride: { value: true, label: "Override GLB Material" },
        roughness: { value: 1, min: 0, max: 1, step: 0.01, label: "Roughness" },
        metalness: { value: 0, min: 0, max: 1, step: 0.01, label: "Metalness" },
        envIntensity: {
          value: 0.4,
          min: 0,
          max: 3,
          step: 0.05,
          label: "Env Intensity",
        },
        flatShading: { value: true, label: "Flat Shading" },
      },
      { collapsed: false },
    ),
    Transform: folder(
      {
        scale: { value: 1, min: 0.01, max: 20, step: 0.01, label: "Scale" },
        posX: { value: 0, min: -20, max: 20, step: 0.1, label: "Pos X" },
        posY: { value: 0, min: -20, max: 20, step: 0.1, label: "Pos Y" },
        posZ: { value: 0, min: -20, max: 20, step: 0.1, label: "Pos Z" },
      },
      { collapsed: true },
    ),
    Rotation: folder(
      {
        rotX: { value: 0, min: -180, max: 180, step: 1, label: "Rot X" },
        rotY: { value: 0, min: -180, max: 180, step: 1, label: "Rot Y" },
        rotZ: { value: 0, min: -180, max: 180, step: 1, label: "Rot Z" },
      },
      { collapsed: true },
    ),
  });
}
