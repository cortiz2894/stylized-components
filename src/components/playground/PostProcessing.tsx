"use client";

import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useControls } from "leva";

interface PostProcessingProps {
  /** Starting values for the Leva sliders — each scene tunes its own bloom. */
  defaults?: {
    mipmapBlur?: boolean;
    intensity?: number;
    radius?: number;
    threshold?: number;
  };
  /** Extra passes/effects for this scene, added to the composer BEFORE the
   *  bloom — so bloom glows off whatever they produced, rather than being
   *  painted over by them. Elements, not ReactNode: the composer collects
   *  passes by walking its children's objects, and its own types say so. */
  children?: React.ReactElement | React.ReactElement[];
  /** Extra passes for AFTER the bloom. For anything that has to see the
   *  finished image — a grade, a tone map, a paper overlay — since bloom adds
   *  light and a tone map only holds if nothing adds light after it. */
  after?: React.ReactElement | React.ReactElement[];
  /** Leva folder. Leva's store is global and keyed by folder + control name, so
   *  scenes sharing this component under one folder would share its VALUES too —
   *  the bloom you dialled in on one demo would follow you to the next. Each
   *  scene passes its own folder to stay isolated. */
  folder?: string;
  /**
   * Whether the renderer clears each pass's target. Leave it alone unless a
   * chain has THREE OR MORE passes that read depth.
   *
   * `postprocessing` attaches the scene's depth to exactly one buffer — the
   * composer's initial input — and every pass with `needsSwap` flips input and
   * output. So the third pass to render writes back into the buffer carrying
   * that attachment, and with autoClear on, that write CLEARS it: every depth
   * reader after that point sees 1.0, i.e. the whole scene at infinity.
   *
   * Nothing throws. A height fog stops fogging, a depth of field cannot be
   * focused, an ambient occlusion produces no occlusion — each of them silently
   * doing nothing while its controls move freely. It is a spectacularly
   * confusing failure to meet from the outside, and it is what forces scenes to
   * ration their depth readers to the first two slots.
   *
   * Turning autoClear OFF removes the rationing. It is safe here because every
   * pass in this chain draws a fullscreen triangle that covers its target
   * completely — there is nothing for a colour clear to do — and the scene
   * render clears explicitly through its own ClearPass rather than relying on
   * this flag.
   */
  autoClear?: boolean;
  /** Scene-level bloom switch, on top of the Intensity slider — for a
   *  breakdown that toggles layers from one place. */
  bloom?: boolean;
}

export default function PostProcessing({
  defaults,
  folder: folderName = "Postprocessing",
  children,
  after,
  autoClear = true,
  bloom = true,
}: PostProcessingProps = {}) {
  const { mipmapBlur, intensity, radius, threshold } = useControls(folderName, {
    mipmapBlur: { value: defaults?.mipmapBlur ?? true, label: "Mipmap Blur" },
    intensity: {
      value: defaults?.intensity ?? 1.1,
      min: 0,
      max: 10,
      step: 0.05,
      label: "Intensity",
    },
    radius: {
      value: defaults?.radius ?? 0.65,
      min: 0,
      max: 1,
      step: 0.01,
      label: "Radius",
    },
    threshold: {
      value: defaults?.threshold ?? 0.33,
      min: 0,
      max: 3,
      step: 0.01,
      label: "Threshold",
    },
  });

  return (
    <EffectComposer autoClear={autoClear}>
      {/* Wrapped in a fragment: the composer types each child as a single
          element, and this way "none" and "several" both satisfy that. It
          collects passes by walking the objects underneath, so the extra
          fragment costs nothing. */}
      <>{children}</>
      <Bloom
        mipmapBlur={mipmapBlur}
        intensity={bloom ? intensity : 0}
        radius={radius}
        luminanceThreshold={threshold}
      />
      <>{after}</>
    </EffectComposer>
  );
}
