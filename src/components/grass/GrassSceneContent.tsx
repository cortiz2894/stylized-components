"use client";

import { Suspense } from "react";
import SceneCamera from "@/components/playground/SceneCamera";
import SceneEnvironment from "@/components/playground/SceneEnvironment";
import PostProcessing from "@/components/playground/PostProcessing";
import type { SceneMode } from "@/components/playground/SceneContent";
import SkyDome from "@/components/skyDome/SkyDome";
import type { SkyPreset, SkyMode } from "@/components/skyDome/constants";
import GrassField from "@/components/GrassField";
import GrassLighting from "./GrassLighting";

interface GrassSceneContentProps {
  mode: SceneMode;
  activePreset: SkyPreset;
  onPresetChange: (preset: SkyPreset) => void;
  /** Key into GRASS_PRESETS — the "season" picked in the overlay. */
  grassPreset: string;
  /** Key into SKY_PRESETS — the sky picked in the overlay. */
  skyMode: SkyMode;
  onModelLoaded?: () => void;
}

export default function GrassSceneContent({
  mode,
  activePreset,
  onPresetChange,
  grassPreset,
  skyMode,
  onModelLoaded,
}: GrassSceneContentProps) {
  return (
    <>
      {/* The "Grass ..." folder names aren't cosmetic: Leva's store is global and
          keyed by folder + control name, so sharing a folder with the water demo
          would mean sharing its values across a navigation. */}
      <SceneCamera folder="Grass Camera" azimuth={41} polar={73} radius={6.5} />
      <GrassLighting preset={activePreset} />
      <SceneEnvironment
        folder="Grass Environment"
        mode={mode}
        background={false}
        defaults={{ preset: "night", envIntensity: 0 }}
      />
      <SkyDome
        defaultMode="day"
        targetMode={skyMode}
        onPresetChange={onPresetChange}
      />
      <Suspense fallback={null}>
        <GrassField
          preset={grassPreset}
          wireframe={mode === "Frame"}
          onLoaded={onModelLoaded}
        />
      </Suspense>
      <PostProcessing
        folder="Grass Postprocessing"
        defaults={{ intensity: 0.3, radius: 0.15, threshold: 0.06 }}
      />
    </>
  );
}
