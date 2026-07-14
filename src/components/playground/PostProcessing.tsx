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
  /** Leva folder. Leva's store is global and keyed by folder + control name, so
   *  scenes sharing this component under one folder would share its VALUES too —
   *  the bloom you dialled in on one demo would follow you to the next. Each
   *  scene passes its own folder to stay isolated. */
  folder?: string;
}

export default function PostProcessing({
  defaults,
  folder: folderName = "Postprocessing",
}: PostProcessingProps = {}) {
  const { mipmapBlur, intensity, radius, threshold } = useControls(
    folderName,
    {
      mipmapBlur: { value: defaults?.mipmapBlur ?? true,  label: "Mipmap Blur" },
      intensity:  { value: defaults?.intensity ?? 1.1,  min: 0, max: 10, step: 0.05, label: "Intensity" },
      radius:     { value: defaults?.radius ?? 0.65,  min: 0, max: 1,  step: 0.01, label: "Radius" },
      threshold:  { value: defaults?.threshold ?? 0.33,   min: 0, max: 3,  step: 0.01, label: "Threshold" },
    }
  );

  return (
    <EffectComposer>
      <Bloom
        mipmapBlur={mipmapBlur}
        intensity={intensity}
        radius={radius}
        luminanceThreshold={threshold}
      />
    </EffectComposer>
  );
}
