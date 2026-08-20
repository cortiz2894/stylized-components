"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import { Effect, EffectAttribute, BlendFunction } from "postprocessing";
import * as THREE from "three";

// ─────────────────────────────────────────────────────────────────────────────
// OutlineFilter — ink lines, by edge-detecting the frame. A 3×3 Sobel, 8 taps
// per pixel. Next to the Kuwahara's 300+ it is free.
//
// ── What it detects: DEPTH or LUMINANCE ──────────────────────────────────────
//
// The same Sobel over two different signals, and the difference is the single
// biggest control over what gets inked:
//
//   DEPTH — geometry only. A shadow does not change depth, and neither does the
//   shading gradient running around a curved surface, so neither gets inked.
//   What survives is the silhouette and the places the form folds in front of
//   itself. This is what "outline" usually means.
//
//   LUMINANCE — anything that changes brightness. Silhouettes, but also cast
//   shadows, terminators, specular flecks and texture detail. Too much on a raw
//   render; exactly right on an image the Kuwahara has already flattened into
//   patches, where the only brightness edges left ARE the patch boundaries.
//
// So the source pairs with the position: depth before the paint, luminance
// after it. Which is not a free choice — see below.
//
// ⚠ The depth source outlines what the DEPTH BUFFER contains, which is not the
// same set of things the viewer can see. Invisible helper geometry that still
// writes depth gets outlined like anything else, and the classic offender is a
// shadow-catching ground plane: transparent in colour, fully present in depth,
// and its far edge draws an ink horizon across an empty background. Set
// `depthWrite={false}` on any such mesh. It keeps receiving shadows and keeps
// depth-testing; it just stops claiming to be geometry.
//
// ── Where it goes, and why it changes the look ───────────────────────────────
//
//   BEFORE the paint — the ink becomes part of the image the Kuwahara then
//   paints. The brush flattens it, aligns its edges to the local flow and
//   breaks it up where the sectors disagree, so the line picks up varying
//   weight and a wobble. It reads as ink laid down WITH a brush.
//
//   AFTER the paint — the line is drawn onto a finished image and nothing
//   touches it afterwards, so it comes out geometrically perfect: constant
//   width, hard edge. It reads as vector art laid over a painting.
//
// The depth source is only available in the first position. `postprocessing`
// attaches the scene depth texture to the composer's INITIAL input buffer, and
// every pass with `needsSwap` rotates it, so a few passes in that attachment
// has been used as a render target and cleared — an outline running after the
// paint would read depth 1.0 everywhere and draw nothing at all.
//
// One thing to know for the before-paint order: keep the line thicker than you
// otherwise would. The Kuwahara is an edge-preserving SMOOTHING filter, and a
// line much thinner than its kernel reads as noise and gets eaten rather than
// stroked. Mounting the pass twice — once each side of the paint — and
// crossfading is how the starter turns that into a knob instead of a cliff.
// ─────────────────────────────────────────────────────────────────────────────

/** Edge signal. Values are the `uSource` uniform, not display order. */
export const OUTLINE_SOURCE = {
  /** Geometry only. Ignores shadows and shading. Needs the depth buffer, so it
   *  only works before any pass that swaps buffers. */
  DEPTH: 1,
  /** Every brightness change. The only option once depth is gone. */
  LUMINANCE: 0,
} as const;

export type OutlineSource =
  (typeof OUTLINE_SOURCE)[keyof typeof OUTLINE_SOURCE];

const OUTLINE_FRAG = /* glsl */ `
  uniform float uStrength;
  uniform float uThickness;
  uniform float uThreshold;
  uniform float uSoftness;
  uniform vec3  uColor;
  uniform vec2  uTexel;
  uniform int   uSource;
  uniform float uNear;
  uniform float uFar;
  /** Before/after wipe, shared with the rest of the chain. 0 disables. */
  uniform float uSplit;

  float lumAt(vec2 p) {
    // Rec.601, matching the weights the paint pass collapses its variance with,
    // so both agree on what counts as a change in value.
    return dot(texture2D(inputBuffer, p).rgb, vec3(0.299, 0.587, 0.114));
  }

  /**
   * Window depth back to a distance in view units.
   *
   * The raw buffer is wildly non-linear — most of its range is spent on the
   * first few percent of the frustum — so a Sobel straight over it would find a
   * cliff at every near edge and nothing at all further out.
   */
  float linearizeDepth(float d) {
    return (uNear * uFar) / (uFar - d * (uFar - uNear));
  }

  /** readDepth(), not a raw texture2D: the buffer may be RGBA-packed depending
   *  on what the renderer could allocate, and the helper handles both. */
  float depthAt(vec2 p) {
    return linearizeDepth(readDepth(p));
  }

  // The \`depth\` parameter is not decoration. postprocessing only declares
  // depthBuffer and readDepth() for an effect whose mainImage SIGNATURE names
  // it — see integrateEffect's depthParamRegExp — so dropping it here would
  // leave the two helpers above referring to identifiers that do not exist.
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    if (uStrength <= 0.0) { outputColor = inputColor; return; }

    // Thickness is a texel multiplier rather than a blur radius: widening the
    // Sobel's reach is what thickens the line, and it stays one 3x3 kernel at
    // any width instead of costing more samples.
    vec2 t = uTexel * uThickness;

    float s00, s10, s20, s01, s11, s21, s02, s12, s22;

    if (uSource == ${OUTLINE_SOURCE.DEPTH}) {
      s00 = depthAt(uv + vec2(-t.x, -t.y));
      s10 = depthAt(uv + vec2( 0.0, -t.y));
      s20 = depthAt(uv + vec2( t.x, -t.y));
      s01 = depthAt(uv + vec2(-t.x,  0.0));
      // The centre tap arrives as a parameter already — one fetch saved.
      s11 = linearizeDepth(depth);
      s21 = depthAt(uv + vec2( t.x,  0.0));
      s02 = depthAt(uv + vec2(-t.x,  t.y));
      s12 = depthAt(uv + vec2( 0.0,  t.y));
      s22 = depthAt(uv + vec2( t.x,  t.y));
    } else {
      s00 = lumAt(uv + vec2(-t.x, -t.y));
      s10 = lumAt(uv + vec2( 0.0, -t.y));
      s20 = lumAt(uv + vec2( t.x, -t.y));
      s01 = lumAt(uv + vec2(-t.x,  0.0));
      s11 = 0.0; // unused by the kernel; only depth needs the centre tap
      s21 = lumAt(uv + vec2( t.x,  0.0));
      s02 = lumAt(uv + vec2(-t.x,  t.y));
      s12 = lumAt(uv + vec2( 0.0,  t.y));
      s22 = lumAt(uv + vec2( t.x,  t.y));
    }

    float gx = -s00 - 2.0 * s01 - s02 + s20 + 2.0 * s21 + s22;
    float gy = -s00 - 2.0 * s10 - s20 + s02 + 2.0 * s12 + s22;
    float g = sqrt(gx * gx + gy * gy);

    // Depth gradients are in world units, so the same step reads as a bigger
    // number up close than far away and one threshold could not serve both.
    // Dividing by the centre distance makes the measure scale-invariant: the
    // threshold then means "this much depth change per unit of distance", and a
    // silhouette inks the same whether it is two metres out or twenty.
    if (uSource == ${OUTLINE_SOURCE.DEPTH}) {
      g /= max(s11, 1e-3);
    }

    // Soft threshold, not a step: a hard cut aliases badly along a diagonal,
    // and the softness knob is also what turns a technical line into one with
    // some weight to it.
    float edge = smoothstep(uThreshold, uThreshold + max(uSoftness, 1e-4), g);

    outputColor = vec4(mix(inputColor.rgb, uColor, edge * uStrength), inputColor.a);

    if (uSplit > 0.0 && uv.x < uSplit) {
      outputColor = inputColor;
    }
  }
`;

export class OutlineEffect extends Effect {
  constructor() {
    super("OutlineEffect", OUTLINE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      // CONVOLUTION: mainImage reads inputBuffer away from its own uv, so it
      // cannot be merged with neighbours that assume it does not.
      // DEPTH: asks the composer for a depth texture. Declared unconditionally
      // — the source is a uniform, so the same compiled effect has to be able
      // to answer either way.
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ["uStrength", new THREE.Uniform(0)],
        ["uThickness", new THREE.Uniform(1)],
        ["uThreshold", new THREE.Uniform(0.25)],
        ["uSoftness", new THREE.Uniform(0.12)],
        ["uColor", new THREE.Uniform(new THREE.Color("#2b2118"))],
        ["uTexel", new THREE.Uniform(new THREE.Vector2(1 / 1280, 1 / 720))],
        ["uSource", new THREE.Uniform(OUTLINE_SOURCE.DEPTH as number)],
        ["uNear", new THREE.Uniform(0.1)],
        ["uFar", new THREE.Uniform(100)],
        ["uSplit", new THREE.Uniform(0)],
      ]),
    });
  }
}

export interface OutlineValues {
  strength: number;
  thickness: number;
  threshold: number;
  softness: number;
  color: string;
  source: OutlineSource;
}

export type OutlineDefaults = Partial<OutlineValues>;

/**
 * The panel, on its own so a page can register it ONCE and drive several
 * mounted passes from it — which is what makes the starter's "Brush Influence"
 * crossfade possible without two competing Leva folders.
 */
export function useOutlineControls(
  folderName = "Outline",
  defaults?: OutlineDefaults,
): OutlineValues {
  const c = useControls(folderName, {
    strength: {
      value: defaults?.strength ?? 0,
      min: 0,
      max: 1,
      step: 0.01,
      label: "Ink Amount",
    },
    source: {
      value: defaults?.source ?? OUTLINE_SOURCE.DEPTH,
      options: {
        "Depth (geometry only)": OUTLINE_SOURCE.DEPTH,
        "Luminance (everything)": OUTLINE_SOURCE.LUMINANCE,
      },
      label: "Edge Source",
    },
    Line: folder(
      {
        thickness: {
          value: defaults?.thickness ?? 5.1,
          min: 0.5,
          max: 6,
          step: 0.1,
          label: "Thickness",
        },
        // The two sources put `g` on completely different scales, so this knob
        // means different things either side of the Edge Source dropdown.
        // Depth wants something around 0.2–0.6; luminance around 0.1–0.5.
        threshold: {
          value: defaults?.threshold ?? 1.25,
          min: 0,
          max: 2,
          step: 0.005,
          label: "Threshold",
        },
        softness: {
          value: defaults?.softness ?? 0.01,
          min: 0.01,
          max: 1,
          step: 0.005,
          label: "Softness",
        },
        color: { value: defaults?.color ?? "#2b2118", label: "Ink Colour" },
      },
      { collapsed: true },
    ),
  });

  return c as OutlineValues;
}

interface OutlinePassProps {
  values: OutlineValues;
  /** Before/after wipe, as a fraction of screen width; 0 disables. Must match
   *  every other effect in the chain. */
  split?: number;
  /** Multiplies `values.strength`. Lets one set of controls drive two mounted
   *  passes at complementary weights. */
  strengthScale?: number;
  /** Overrides `values.source`. The instance sitting after a buffer swap has no
   *  usable depth texture, so it is pinned to luminance regardless of what the
   *  dropdown says. */
  forceSource?: OutlineSource;
}

/** The pass, driven entirely by props. Registers no Leva of its own. */
export function OutlinePass({
  values,
  split = 0,
  strengthScale = 1,
  forceSource,
}: OutlinePassProps) {
  const effect = useMemo(() => new OutlineEffect(), []);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const u = effect.uniforms;
    u.get("uStrength")!.value = values.strength * strengthScale;
    u.get("uThickness")!.value = values.thickness;
    u.get("uThreshold")!.value = values.threshold;
    u.get("uSoftness")!.value = values.softness;
    u.get("uSource")!.value = forceSource ?? values.source;
    (u.get("uColor")!.value as THREE.Color).set(values.color);
  }, [effect, values, strengthScale, forceSource]);

  useEffect(() => {
    // One texel of the DRAWING buffer, not of the CSS box — the shader steps in
    // real pixels, so a line would come out half as wide on a dpr-2 canvas if
    // this used the layout size.
    const texel = effect.uniforms.get("uTexel")!.value as THREE.Vector2;
    texel.set(
      1 / Math.max(size.width * dpr, 1),
      1 / Math.max(size.height * dpr, 1),
    );
  }, [effect, size, dpr]);

  useEffect(() => {
    // Read live rather than hard-coded: linearising depth is meaningless
    // without the exact frustum that produced it, and a scene is free to change
    // near/far at runtime.
    const persp = camera as THREE.PerspectiveCamera;
    effect.uniforms.get("uNear")!.value = persp.near ?? 0.1;
    effect.uniforms.get("uFar")!.value = persp.far ?? 100;
  }, [effect, camera]);

  useEffect(() => {
    effect.uniforms.get("uSplit")!.value = split;
  }, [effect, split]);

  useEffect(() => () => effect.dispose(), [effect]);

  return <primitive object={effect} dispose={null} />;
}

interface OutlineFilterProps {
  /** Leva folder — kept per scene, since Leva's store is global. */
  folder?: string;
  defaults?: OutlineDefaults;
  split?: number;
}

/** The pass plus its own panel — the self-contained form, for a scene that
 *  mounts the outline once. */
export default function OutlineFilter({
  folder: folderName = "Outline",
  defaults,
  split = 0,
}: OutlineFilterProps) {
  const values = useOutlineControls(folderName, defaults);
  return <OutlinePass values={values} split={split} />;
}
