"use client";

import { Suspense } from "react";
import SceneCamera from "@/components/playground/SceneCamera";
import SceneEnvironment from "@/components/playground/SceneEnvironment";
import PostProcessing from "@/components/playground/PostProcessing";
import type { SceneMode } from "@/components/playground/SceneContent";
import SkyDome from "@/components/skyDome/SkyDome";
import type { SkyPreset } from "@/components/skyDome/constants";
import GrassField from "@/components/GrassField";
import GrassLighting from "./GrassLighting";

interface GrassSceneContentProps {
  mode: SceneMode;
  activePreset: SkyPreset;
  onPresetChange: (preset: SkyPreset) => void;
  /** Key into GRASS_PRESETS — the "season" picked in the overlay. */
  grassPreset: string;
  onModelLoaded?: () => void;
}

export default function GrassSceneContent({
  mode,
  activePreset,
  onPresetChange,
  grassPreset,
  onModelLoaded,
}: GrassSceneContentProps) {
  return (
    <>
      <SceneCamera azimuth={41} polar={73} radius={6.5} />
      <GrassLighting preset={activePreset} />
      {/* SkyDome owns the backdrop. The HDRI is mounted but its contribution is
          off by default (envIntensity 0) — GrassLighting drives this scene. */}
      <SceneEnvironment
        mode={mode}
        background={false}
        defaults={{ preset: "night", envIntensity: 0 }}
      />
      <SkyDome defaultMode="day" onPresetChange={onPresetChange} />
      <Suspense fallback={null}>
        <GrassField
          preset={grassPreset}
          wireframe={mode === "Frame"}
          onLoaded={onModelLoaded}
        />
      </Suspense>
      {/* Softer, tighter bloom than the water scene — the grass reads better
          with just a light glow on the brightest blades. */}
      <PostProcessing defaults={{ intensity: 0.3, radius: 0.15, threshold: 0.06 }} />
    </>
  );
}
