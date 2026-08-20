"use client";

import { useEffect, useMemo } from "react";
import { useControls, folder } from "leva";
import {
  AnisotropicKuwaharaPass,
  KUWAHARA_DEFAULTS,
  type AnisotropicKuwaharaOptions,
} from "./AnisotropicKuwaharaPass";
import {
  KUWAHARA_DEBUG,
  type KuwaharaDebugMode,
} from "./glsl/anisotropicKuwahara";

// ─────────────────────────────────────────────────────────────────────────────
// <KuwaharaFilter /> — the pass as a component, for use INSIDE an
// <EffectComposer> from @react-three/postprocessing:
//
//   <EffectComposer>
//     <KuwaharaFilter folder="Painterly Paint" />
//     <Bloom />
//   </EffectComposer>
//
// The composer walks its children and adds any `postprocessing` Pass instance
// it finds, in order — which is why this renders a bare <primitive>. Every knob
// is a uniform, so nothing here rebuilds the pass.
// ─────────────────────────────────────────────────────────────────────────────

interface KuwaharaFilterProps {
  /** Leva folder. Kept per scene: Leva's store is global and keyed by folder +
   *  control name, so two demos sharing one would share these values too. */
  folder?: string;
  /** Starting values. EVERY knob honours these, not just `radius` — the panel
   *  writes its values onto the pass on mount, so anything it did not read
   *  from here would silently overwrite what the constructor was given. */
  defaults?: AnisotropicKuwaharaOptions;
  /** Show the debug view picker in the panel. Off by default: it is a teaching
   *  aid, and a production scene should not ship a control that can turn the
   *  image into a false-colour orientation field. */
  showDebug?: boolean;
  /** Before/after wipe, as a fraction of screen width; 0 disables.
   *
   *  Pass this when something else in the chain has to bypass the same strip —
   *  a grade running after the paint has to, or the "before" side is the
   *  unpainted scene with the rest of the chain still on it. Providing it also
   *  hides the panel's own wipe slider, so the page owns the value outright
   *  instead of two controls fighting over one uniform. Leave it out and the
   *  filter keeps its self-contained slider. */
  split?: number;
}

export default function KuwaharaFilter({
  folder: folderName = "Paint",
  defaults,
  showDebug = false,
  split: splitProp,
}: KuwaharaFilterProps) {
  const pass = useMemo(() => new AnisotropicKuwaharaPass(defaults), []); // eslint-disable-line react-hooks/exhaustive-deps

  const { enabled, radius, alpha, eta, lambda } = useControls(folderName, {
    enabled: { value: true, label: "Paint (Kuwahara)" },
    // The cost knob: 8 sectors × radius × 5 samples per pixel. 5 is already
    // 200 texture fetches; past ~8 the brush also gets so wide that small
    // detail stops surviving at all.
    radius: {
      value: defaults?.radius ?? KUWAHARA_DEFAULTS.radius,
      min: 1,
      max: 12,
      step: 1,
      label: "Brush Size (cost!)",
    },
    Kernel: folder(
      {
        // Low = the kernel stretches along the image flow as soon as there is
        // any, which is what makes strokes run along an edge instead of
        // sitting on it as blobs.
        //
        // The scale is brutally non-linear: 1 is a 4:1 kernel, 25 is 1.08:1,
        // and everything past ~20 is a circle. So the top of this range is
        // "anisotropy off" and the whole effect lives in the first few units.
        // Leva CLAMPS an out-of-range starting value to the max rather than
        // warning, which is how this control spent a while pinned to the round
        // end while its own default claimed otherwise.
        alpha: {
          value: defaults?.alpha ?? KUWAHARA_DEFAULTS.alpha,
          min: 0.5,
          max: 25,
          step: 0.1,
          label: "Roundness",
        },
        eta: {
          value: defaults?.eta ?? KUWAHARA_DEFAULTS.eta,
          min: 0,
          max: 1,
          step: 0.01,
          label: "Sector Bias",
        },
        lambda: {
          value: defaults?.lambda ?? KUWAHARA_DEFAULTS.lambda,
          min: 0,
          max: 2,
          step: 0.01,
          label: "Sector Falloff",
        },
      },
      { collapsed: true },
    ),
  });

  useEffect(() => {
    // Setters onto the memoised pass: every one of these writes a uniform, so
    // dragging a slider costs nothing and rebuilds nothing.
    // eslint-disable-next-line react-hooks/immutability
    pass.enabled = enabled;
    pass.radius = radius;
    pass.alpha = alpha;
    pass.eta = eta;
    pass.lambda = lambda;
  }, [pass, enabled, radius, alpha, eta, lambda]);

  useDebugControls(pass, folderName, showDebug, defaults, splitProp);

  // Worth disposing, unlike most of what a scene memoises: the pass owns a
  // screen-sized half-float target. (StrictMode's fake unmount in dev fires
  // this early — three re-creates the target and the program the next time they
  // are used, which is why the composer's own effects clean up the same way.)
  useEffect(() => () => pass.dispose(), [pass]);

  return <primitive object={pass} dispose={null} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug controls — optional, and separable from everything above.
//
// The dropdown replaces the paint with a picture of one of the filter's own
// intermediate values, and the wipe shows the untouched scene down one side.
// Both exist to be shown to someone, not to ship. Delete this half of the file
// and the `showDebug` prop with it and the filter is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/** Ordered so the dropdown reads as the filter's actual pipeline: what pass 1
 *  produced, what pass 2 made of it, then the result and its naive twin. */
const DEBUG_VIEWS: Record<string, KuwaharaDebugMode> = {
  "Off — the paint": KUWAHARA_DEBUG.OFF,
  "1 · Structure tensor": KUWAHARA_DEBUG.TENSOR,
  "2 · Flow direction": KUWAHARA_DEBUG.ORIENTATION,
  "3 · Anisotropy": KUWAHARA_DEBUG.ANISOTROPY,
  "4 · Winning sector": KUWAHARA_DEBUG.SECTOR,
  "5 · Sector variance": KUWAHARA_DEBUG.VARIANCE,
  "6 · Isotropic (naive)": KUWAHARA_DEBUG.ISOTROPIC,
};

function useDebugControls(
  pass: AnisotropicKuwaharaPass,
  folderName: string,
  showDebug: boolean,
  defaults?: AnisotropicKuwaharaOptions,
  splitProp?: number,
) {
  // Controlled when the page passes a wipe value; self-contained otherwise.
  const controlled = splitProp !== undefined;

  // Registered unconditionally — hooks cannot be — and hidden with Leva's own
  // `render` predicate rather than by building a different schema, which would
  // change the hook's shape when the prop flips.
  const { debug, split } = useControls(folderName, {
    Debug: folder(
      {
        debug: {
          value: defaults?.debug ?? KUWAHARA_DEBUG.OFF,
          options: DEBUG_VIEWS,
          label: "View",
          render: () => showDebug,
        },
        split: {
          value: defaults?.split ?? 0,
          min: 0,
          max: 1,
          step: 0.001,
          label: "Before/After Wipe",
          render: () => showDebug && !controlled,
        },
      },
      { collapsed: false, render: () => showDebug },
    ),
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    pass.debug = debug;
    pass.split = splitProp ?? split;
  }, [pass, debug, split, splitProp]);
}
