import * as THREE from "three";
import { MAX_ROCKS } from "./shaders/grassBlade";

// ─────────────────────────────────────────────────────────────────────────────
// Uniforms
//
// Every material in the field (blades, ground, flowers, pine needles, bark)
// reads from ONE bag of IUniform objects, created once per <GrassField /> and
// mutated in place each frame. Two consequences worth knowing:
//
//   · A single `.value` write drives every GPU instance that shares the object,
//     so changing a color or the wind never recompiles a shader and never
//     respawns an instance. Only the params marked "(rebuilds)" in the Leva
//     panel — the ones that change blade/flower GEOMETRY — rebuild anything.
//
//   · The blades and the ground deliberately share uGrassBottom, uBrightness and
//     the whole dirt block. That sharing is not incidental: it is what makes the
//     blade bases and the ground they grow out of resolve to exactly the same
//     color, and what makes both agree on where the dirt patches are.
// ─────────────────────────────────────────────────────────────────────────────

/** Blades: wind, color gradient, dirt, rock trampling, translucency. */
export type BladeUniforms = {
  uTime: THREE.IUniform<number>;

  // Wind
  uWindStrength: THREE.IUniform<number>;
  uWindSpeed: THREE.IUniform<number>;
  uWindFreq: THREE.IUniform<number>;
  uWindTurb: THREE.IUniform<number>;
  uWindLean: THREE.IUniform<number>;
  uWindDir: THREE.IUniform<THREE.Vector2>;

  // Color. The blade height [0 = base, 1 = tip] is remapped through
  // start/end/power before mixing bottom → top, so the base color can be held
  // down near the ground (where it must match the terrain) while the tip color
  // stays concentrated at the tips.
  uGrassBottom: THREE.IUniform<THREE.Color>;
  uGrassTop: THREE.IUniform<THREE.Color>;
  uBrightness: THREE.IUniform<number>;
  uGradStart: THREE.IUniform<number>;
  uGradEnd: THREE.IUniform<number>;
  uGradPower: THREE.IUniform<number>;

  // Shadows — soft, multi-tap ring around the blade (see GRASS_SHADOW_VERTEX).
  uShadowStrength: THREE.IUniform<number>; // how dark a fully-shadowed blade gets
  uShadowSamples: THREE.IUniform<number>; // taps averaged (1 = crisp, more = softer)
  uShadowSampleY: THREE.IUniform<number>; // height up the blade the kernel sits at
  uShadowRadius: THREE.IUniform<number>; // world-space penumbra radius (kills flicker)

  // Dirt colormap — shared with the ground material.
  uDirtColor: THREE.IUniform<THREE.Color>;
  uDirtScale: THREE.IUniform<number>;
  uDirtCoverage: THREE.IUniform<number>; // 0 = no dirt anywhere
  uDirtSoftness: THREE.IUniform<number>;
  uDirtWarp: THREE.IUniform<number>;
  uDirtCut: THREE.IUniform<number>; // blade shortening over dirt
  uDirtBlend: THREE.IUniform<number>; // how much a blade takes the dirt color

  // Rock trampling — xyz = centre, w = radius, in world space.
  uRocks: THREE.IUniform<THREE.Vector4[]>;
  uRockCount: THREE.IUniform<number>;
  uRockRadiusMul: THREE.IUniform<number>;
  uRockFalloff: THREE.IUniform<number>;
  uRockFlatten: THREE.IUniform<number>;
  uRockBend: THREE.IUniform<number>;

  // Translucency (subsurface back-light). uSunDir/uSunColor mirror the scene's
  // directional light — GrassField writes them every frame.
  uSunDir: THREE.IUniform<THREE.Vector3>; // world, blade → sun
  uSunColor: THREE.IUniform<THREE.Color>; // color × intensity
  uTransColor: THREE.IUniform<THREE.Color>;
  uTransStrength: THREE.IUniform<number>; // 0 = off
  uTransPower: THREE.IUniform<number>; // back-lobe sharpness
  uTransTip: THREE.IUniform<number>; // 0 = whole blade, 1 = tips only
  uTransShadow: THREE.IUniform<number>; // 1 = shadows kill transmission

  // ── Breakdown / teaching switches ─────────────────────────────────────────
  /** Paints one intermediate value instead of the final color (0 = off). The
   *  debug view runs inside the real shader, so it can't drift from it. */
  uDebugChannel: THREE.IUniform<number>;
  /** 0 reintroduces the fan-out bug: the world-space wind vector is applied as
   *  if it were blade-local, so every blade leans along its own random rotation. */
  uWindFixLocal: THREE.IUniform<number>;
};

/** Ground plane: how it matches the blades, plus its own texture and relief. */
export type GroundUniforms = {
  uTintFloor: THREE.IUniform<number>; // 1 = ground takes the blades' bottom color
  uFlatFloorNormal: THREE.IUniform<number>; // 1 = ground shades with the blades' +Y normal
  uGndVarColor: THREE.IUniform<THREE.Color>;
  uGndVarScale: THREE.IUniform<number>;
  uGndVarStrength: THREE.IUniform<number>;
  uGndGrainScale: THREE.IUniform<number>;
  uGndGrainStrength: THREE.IUniform<number>;
  uGndReliefScale: THREE.IUniform<number>;
  uGndReliefStrength: THREE.IUniform<number>;
};

/** Pine needles: an RGB repaint over the GLB texture's alpha, plus wind.
 *  The wind itself (direction, speed, frequency, time) is the grass's — only the
 *  amplitude and flutter below are leaf-specific, so trees and blades sway to the
 *  same gust. */
export type PineLeafUniforms = {
  uLeafBottom: THREE.IUniform<THREE.Color>;
  uLeafTop: THREE.IUniform<THREE.Color>;
  uLeafBrightness: THREE.IUniform<number>;
  uLeafGradPower: THREE.IUniform<number>;
  uLeafVarColor: THREE.IUniform<THREE.Color>;
  uLeafVarStrength: THREE.IUniform<number>;
  uLeafVarScale: THREE.IUniform<number>;
  uLeafWindStrength: THREE.IUniform<number>; // 0 = still
  uLeafFlutterAmp: THREE.IUniform<number>;
  uLeafFlutterSpeed: THREE.IUniform<number>;
  uLeafDip: THREE.IUniform<number>;
};

/** Trunk bark: color + AO + height maps, sampled by hand (see barkMaterial). */
export type BarkUniforms = {
  uBarkColorMap: THREE.IUniform<THREE.Texture | null>;
  uBarkAOMap: THREE.IUniform<THREE.Texture | null>;
  uBarkHeightMap: THREE.IUniform<THREE.Texture | null>;
  uBarkScale: THREE.IUniform<number>;
  uBarkTint: THREE.IUniform<THREE.Color>;
  uBarkTintStrength: THREE.IUniform<number>;
  uBarkSaturation: THREE.IUniform<number>;
  uBarkBrightness: THREE.IUniform<number>;
  uBarkAOStrength: THREE.IUniform<number>;
  uBarkRelief: THREE.IUniform<number>;
};

/** The dirt colormap. Read by the ground, the blades AND the flowers — they all
 *  call the same groundDirt(), which is what makes them agree on where the bare
 *  earth is. */
export type DirtUniforms = Pick<
  BladeUniforms,
  "uDirtColor" | "uDirtScale" | "uDirtCoverage" | "uDirtSoftness" | "uDirtWarp"
>;

/** Flowers: palette + wind. Shared by every flower variant. */
export type FlowerUniforms = {
  uColorR: THREE.IUniform<THREE.Color>;
  uColorG: THREE.IUniform<THREE.Color>;
  uColorB: THREE.IUniform<THREE.Color>;
  uColorStem: THREE.IUniform<THREE.Color>;
  uGrassColor: THREE.IUniform<THREE.Color>;
  uBrightness: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uWindStrength: THREE.IUniform<number>;
  uWindSpeed: THREE.IUniform<number>;
  uWindFreq: THREE.IUniform<number>;
  uWindTurb: THREE.IUniform<number>;
  uWindLean: THREE.IUniform<number>;
  uWindDir: THREE.IUniform<THREE.Vector2>;
  uBendAmp: THREE.IUniform<number>;
  uBendFreq: THREE.IUniform<number>;
  /** Flowers are culled where the dirt mask exceeds this — they grow in grass,
   *  not on bare earth. 1 = never culled. */
  uFlDirtMax: THREE.IUniform<number>;
};

/** One texture set per flower variant; everything else is shared. */
export type FlowerTextures = {
  uFlowerMask: THREE.IUniform<THREE.Texture | null>;
  uFlowerRGB: THREE.IUniform<THREE.Texture | null>;
  uFlowerGradient: THREE.IUniform<THREE.Texture | null>;
};

/** The blades, the ground and the pine needles all read from this one object. */
export type SurfaceUniforms = BladeUniforms & GroundUniforms & PineLeafUniforms;

export interface GrassFieldUniforms {
  surface: SurfaceUniforms;
  flower: FlowerUniforms;
  flowerTexA: FlowerTextures;
  flowerTexB: FlowerTextures;
  bark: BarkUniforms;
}

export function createGrassFieldUniforms(): GrassFieldUniforms {
  return {
    surface: {
      uTime: { value: 0 },

      uWindStrength: { value: 0.3 },
      uWindSpeed: { value: 1.2 },
      uWindFreq: { value: 0.4 },
      uWindTurb: { value: 0.3 },
      uWindLean: { value: 0.5 },
      uWindDir: { value: new THREE.Vector2(1, 0) },

      uGrassBottom: { value: new THREE.Color("#4f7c13") },
      uGrassTop: { value: new THREE.Color("#79a01c") },
      uBrightness: { value: 0.8 },
      uGradStart: { value: 0.15 },
      uGradEnd: { value: 1.0 },
      uGradPower: { value: 1.6 },

      uShadowStrength: { value: 0.6 },
      uShadowSamples: { value: 4 },
      uShadowSampleY: { value: 0.4 },
      uShadowRadius: { value: 0.3 },

      // Coverage 0 keeps the dirt feature dormant until it is dialled in.
      uDirtColor: { value: new THREE.Color("#ac956c") },
      uDirtScale: { value: 0.4 },
      uDirtCoverage: { value: 0.0 },
      uDirtSoftness: { value: 0.06 },
      uDirtWarp: { value: 0.2 },
      uDirtCut: { value: 1.0 },
      uDirtBlend: { value: 0.8 },

      // The array is always MAX_ROCKS long — GLSL uniform arrays are fixed size;
      // uRockCount is what limits the loop.
      uRocks: {
        value: Array.from({ length: MAX_ROCKS }, () => new THREE.Vector4()),
      },
      uRockCount: { value: 0 },
      uRockRadiusMul: { value: 1.0 },
      uRockFalloff: { value: 0.35 },
      uRockFlatten: { value: 0.85 },
      uRockBend: { value: 0.25 },

      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uTransColor: { value: new THREE.Color("#c1e54d") },
      uTransStrength: { value: 0.9 },
      uTransPower: { value: 3.0 },
      uTransTip: { value: 0.6 },
      uTransShadow: { value: 1.0 },

      uDebugChannel: { value: 0 },
      uWindFixLocal: { value: 1 },

      uTintFloor: { value: 1 },
      uFlatFloorNormal: { value: 1 },
      uGndVarColor: { value: new THREE.Color("#c4a77d") },
      uGndVarScale: { value: 1.24 },
      uGndVarStrength: { value: 0.9 },
      uGndGrainScale: { value: 6.7 },
      uGndGrainStrength: { value: 0.95 },
      uGndReliefScale: { value: 0.5 },
      uGndReliefStrength: { value: 0.0 },

      uLeafBottom: { value: new THREE.Color("#1c3b23") },
      uLeafTop: { value: new THREE.Color("#5c8338") },
      uLeafBrightness: { value: 1.05 },
      uLeafGradPower: { value: 1.1 },
      uLeafVarColor: { value: new THREE.Color("#1e4430") },
      uLeafVarStrength: { value: 0.6 },
      uLeafVarScale: { value: 2.5 },
      uLeafWindStrength: { value: 0.12 },
      uLeafFlutterAmp: { value: 0.35 },
      uLeafFlutterSpeed: { value: 3.2 },
      uLeafDip: { value: 0.25 },
    },

    flower: {
      uColorR: { value: new THREE.Color("#b084c7") },
      uColorG: { value: new THREE.Color("#cbb36a") },
      uColorB: { value: new THREE.Color("#9287ff") },
      uColorStem: { value: new THREE.Color("#648029") },
      uGrassColor: { value: new THREE.Color("#4f7c13") },
      uBrightness: { value: 1.0 },
      uTime: { value: 0 },
      uWindStrength: { value: 0.15 },
      uWindSpeed: { value: 0.8 },
      uWindFreq: { value: 0.3 },
      uWindTurb: { value: 0.2 },
      uWindLean: { value: 0.25 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uBendAmp: { value: 0.12 },
      uBendFreq: { value: 3.0 },
      uFlDirtMax: { value: 0.15 },
    },

    // Maps are attached once the loader has them (see GrassField).
    flowerTexA: {
      uFlowerMask: { value: null },
      uFlowerRGB: { value: null },
      uFlowerGradient: { value: null },
    },
    flowerTexB: {
      uFlowerMask: { value: null },
      uFlowerRGB: { value: null },
      uFlowerGradient: { value: null },
    },

    bark: {
      uBarkColorMap: { value: null },
      uBarkAOMap: { value: null },
      uBarkHeightMap: { value: null },
      uBarkScale: { value: 5.6 },
      uBarkTint: { value: new THREE.Color("#8a6a4a") },
      uBarkTintStrength: { value: 0 },
      uBarkSaturation: { value: 0.7 },
      uBarkBrightness: { value: 1.55 },
      uBarkAOStrength: { value: 0.45 },
      uBarkRelief: { value: 1.5 },
    },
  };
}
