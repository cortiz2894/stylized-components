"use client";

import { useEffect, useMemo } from "react";
import { useControls, folder } from "leva";
import { Effect, BlendFunction } from "postprocessing";
import * as THREE from "three";
import { makeProceduralGrainTexture } from "./textures/grainTexture";

// ─────────────────────────────────────────────────────────────────────────────
// WatercolorFilter — the last layer: posterise, saturate, tone map, then lay
// the whole frame on paper.
//
// It goes AFTER everything else, bloom included, because it ends in an ACES
// curve and a tone map is only a tone map if nothing adds light after it.
// @react-three/postprocessing sets `gl.toneMapping = NoToneMapping` for as long
// as the composer is mounted, so this is not fighting three's own — it IS the
// scene's tone mapping.
//
// The order inside is deliberate and not interchangeable:
//
//   1. QUANTISE on luminance, not on colour. Stepping each channel separately
//      shifts hue at every step boundary; stepping the value and then pushing
//      the ORIGINAL colour toward black or white keeps the hue and only bands
//      the value, which is what watercolour actually does.
//   2. SATURATE, after the banding, so the flats come back up — posterising
//      through a luminance ramp always costs some chroma.
//   3. ACES last of the three: it is the curve that maps the result into
//      display range, so anything after it would be outside the range it just
//      established.
//   4. PAPER, multiplied over the graded result.
// ─────────────────────────────────────────────────────────────────────────────
const WATERCOLOR_FRAG = /* glsl */ `
  uniform sampler2D uPaper;
  uniform float uPaperStrength;
  uniform float uPaperScale;
  uniform float uSteps;
  uniform float uQuantLow;
  uniform float uQuantHigh;
  uniform vec3  uShadowTint;
  uniform float uSaturation;
  uniform float uMix;
  /** Before/after wipe, shared with the paint pass upstream. 0 disables. */
  uniform float uSplit;

  vec3 wcACES(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  vec3 wcSat(vec3 rgb, float adjustment) {
    // Rec.709 luminance weights — the same basis the quantiser uses, so the
    // two agree on what "value" means.
    vec3 W = vec3(0.2125, 0.7154, 0.0721);
    vec3 intensity = vec3(dot(rgb, W));
    return mix(intensity, rgb, adjustment);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = inputColor.rgb;

    // ── 1. Quantise the VALUE ────────────────────────────────────────────
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    float n = max(uSteps, 2.0);
    float qn = floor(lum * (n - 1.0) + 0.5) / (n - 1.0);

    // The clamp is what keeps this from being a hard posterise: it throws away
    // the ends of the ramp, so nothing is ever pushed the whole way to the
    // shadow tint or the whole way to white. Widening it toward 0..1 is the
    // knob for a harsher, more graphic result.
    qn = clamp(qn, uQuantLow, uQuantHigh);

    vec3 graded = (qn < 0.5)
      ? mix(uShadowTint, color, qn * 2.0)
      : mix(color, vec3(1.0), (qn - 0.5) * 2.0);

    // ── 2 & 3. Chroma back up, then into display range ───────────────────
    graded = wcSat(graded, uSaturation);
    graded = wcACES(graded);

    // ── 4. Paper ─────────────────────────────────────────────────────────
    // Aspect-corrected so the fibre stays round on a wide viewport instead of
    // being stretched with the frame.
    vec2 puv = (uv - 0.5) * vec2(aspect, 1.0) * uPaperScale + 0.5;
    vec3 paper = texture2D(uPaper, puv).rgb;
    // Mixed toward WHITE by strength rather than multiplied raw. A raw multiply
    // makes the pass all-or-nothing, and — worse — an unbound or dark sampler
    // then takes the whole frame to black with no clue where it came from.
    // This way strength 0 is a guaranteed no-op.
    graded *= mix(vec3(1.0), paper, uPaperStrength);

    // Whole pass on one fader, so it can be dialled against the rest of the
    // stack instead of only being on or off.
    outputColor = vec4(mix(color, graded, uMix), inputColor.a);

    // Before/after wipe. The paint pass upstream hands the raw scene through
    // on the left of the seam; this bypasses the SAME strip so that side is
    // genuinely untouched. Grade it anyway and the comparison silently becomes
    // "graded vs graded-and-painted", which flatters the paint.
    if (uSplit > 0.0 && uv.x < uSplit) {
      outputColor = inputColor;
    }
  }
`;

export class WatercolorEffect extends Effect {
  constructor(paper: THREE.Texture) {
    super("WatercolorEffect", WATERCOLOR_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["uPaper", new THREE.Uniform(paper)],
        ["uPaperStrength", new THREE.Uniform(0.35)],
        ["uPaperScale", new THREE.Uniform(1)],
        ["uSteps", new THREE.Uniform(16)],
        ["uQuantLow", new THREE.Uniform(0.2)],
        ["uQuantHigh", new THREE.Uniform(0.7)],
        ["uShadowTint", new THREE.Uniform(new THREE.Color(0.1, 0.1, 0.1))],
        ["uSaturation", new THREE.Uniform(1.5)],
        ["uMix", new THREE.Uniform(1)],
        ["uSplit", new THREE.Uniform(0)],
      ]),
    });
  }
}

export interface WatercolorDefaults {
  mix?: number;
  steps?: number;
  quantLow?: number;
  quantHigh?: number;
  shadowTint?: string;
  saturation?: number;
  paperStrength?: number;
  paperScale?: number;
}

interface WatercolorFilterProps {
  /** Leva folder. Kept per scene — Leva's store is global and keyed by folder
   *  plus control name. */
  folder?: string;
  defaults?: WatercolorDefaults;
  /** Before/after wipe, as a fraction of screen width; 0 disables. Drive it
   *  from the SAME value the paint pass gets — the two have to bypass the same
   *  strip or the "before" side is a graded copy of the raw scene rather than
   *  the raw scene. Owned by the page, since a wipe spanning a chain of
   *  effects is not any one effect's business. */
  split?: number;
}

export default function WatercolorFilter({
  folder: folderName = "Watercolor",
  defaults,
  split = 0,
}: WatercolorFilterProps) {
  // Procedural rather than a PNG: the painterly package already generates a
  // greyscale fibre field, it costs less than fetching an image, and it means
  // the pass has a paper bound from the first frame — which is the difference
  // between "subtle" and "the screen is black".
  const paper = useMemo(() => {
    const tex = makeProceduralGrainTexture({
      size: 512,
      // Near-isotropic: paper tooth is not wood grain, so the strong stretch
      // the bark preset wants would read as brushed metal here.
      stretch: 1.4,
      frequency: 28,
      octaves: 4,
      contrast: 0.8,
      seed: 7,
    });
    // Set here rather than in an effect: the texture is created in this memo
    // and owned by this component, so there is nothing shared to mutate.
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }, []);

  const effect = useMemo(() => new WatercolorEffect(paper), [paper]);

  useEffect(
    () => () => {
      effect.dispose();
      paper.dispose();
    },
    [effect, paper],
  );

  const c = useControls(folderName, {
    mix: {
      value: defaults?.mix ?? 0.9,
      min: 0,
      max: 1,
      step: 0.01,
      label: "Amount",
    },
    Tone: folder(
      {
        steps: {
          value: defaults?.steps ?? 33,
          min: 2,
          max: 64,
          step: 1,
          label: "Value Steps",
        },
        // Together these are how much of the ramp survives. Pulling them apart
        // toward 0 and 1 is the harsh, graphic end.
        quantLow: {
          value: defaults?.quantLow ?? 0.36,
          min: 0,
          max: 0.5,
          step: 0.01,
          label: "Shadow Floor",
        },
        quantHigh: {
          value: defaults?.quantHigh ?? 0.86,
          min: 0.5,
          max: 1,
          step: 0.01,
          label: "Highlight Ceiling",
        },
        shadowTint: {
          value: defaults?.shadowTint ?? "#1a1a1a",
          label: "Shadow Tint",
        },
        saturation: {
          value: defaults?.saturation ?? 1,
          min: 0,
          max: 3,
          step: 0.01,
          label: "Saturation",
        },
      },
      { collapsed: false },
    ),
    Paper: folder(
      {
        paperStrength: {
          value: defaults?.paperStrength ?? 0.35,
          min: 0,
          max: 1,
          step: 0.01,
          label: "Strength",
        },
        paperScale: {
          value: defaults?.paperScale ?? 1,
          min: 0.2,
          max: 8,
          step: 0.05,
          label: "Scale",
        },
      },
      { collapsed: true },
    ),
  });

  useEffect(() => {
    const u = effect.uniforms;
    u.get("uMix")!.value = c.mix;
    u.get("uSteps")!.value = c.steps;
    u.get("uQuantLow")!.value = c.quantLow;
    // Guarded: a ceiling below the floor inverts the clamp and GLSL's clamp is
    // undefined when min > max, which shows up as a full-screen flicker.
    u.get("uQuantHigh")!.value = Math.max(c.quantHigh, c.quantLow + 0.01);
    (u.get("uShadowTint")!.value as THREE.Color).set(c.shadowTint);
    u.get("uSaturation")!.value = c.saturation;
    u.get("uPaperStrength")!.value = c.paperStrength;
    u.get("uPaperScale")!.value = c.paperScale;
  }, [effect, c]);

  useEffect(() => {
    effect.uniforms.get("uSplit")!.value = split;
  }, [effect, split]);

  return <primitive object={effect} dispose={null} />;
}
