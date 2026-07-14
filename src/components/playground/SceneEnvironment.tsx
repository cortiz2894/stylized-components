"use client";

import { Environment } from "@react-three/drei";
import { useControls, folder } from "leva";
import type { SceneMode } from "./SceneContent";

type EnvPreset =
  | "apartment"
  | "city"
  | "dawn"
  | "forest"
  | "lobby"
  | "night"
  | "park"
  | "studio"
  | "sunset"
  | "warehouse";

interface SceneEnvironmentProps {
  mode: SceneMode;
  /** Defaults to `mode === "Background"`. Pass false when something else owns
   *  the backdrop (e.g. the grass scene's SkyDome) but the HDRI is still wanted
   *  for image-based lighting. */
  background?: boolean;
  /** Starting values for the Leva sliders — each scene tunes its own HDRI. */
  defaults?: {
    preset?: EnvPreset;
    bgBlurriness?: number;
    bgIntensity?: number;
    envIntensity?: number;
  };
}

export default function SceneEnvironment({
  mode,
  background,
  defaults,
}: SceneEnvironmentProps) {
  const { preset, bgBlurriness, bgIntensity, envIntensity } = useControls(
    "Environment",
    {
      preset: {
        value: (defaults?.preset ?? "park") as EnvPreset,
        options: [
          "apartment",
          "city",
          "dawn",
          "forest",
          "lobby",
          "night",
          "park",
          "studio",
          "sunset",
          "warehouse",
        ] as EnvPreset[],
        label: "Preset",
      },
      bgBlurriness: { value: defaults?.bgBlurriness ?? 0.9, min: 0, max: 1, step: 0.01, label: "Bg Blur" },
      bgIntensity: { value: defaults?.bgIntensity ?? 0.3, min: 0, max: 2, step: 0.05, label: "Bg Intensity" },
      envIntensity: { value: defaults?.envIntensity ?? 1, min: 0, max: 3, step: 0.05, label: "Env Intensity" },
    },
  );

  return (
    <Environment
      preset={preset}
      background={background ?? mode === "Background"}
      backgroundBlurriness={bgBlurriness}
      backgroundIntensity={bgIntensity}
      environmentIntensity={envIntensity}
    />
  );
}
