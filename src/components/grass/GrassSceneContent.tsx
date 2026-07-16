"use client";

import { Suspense, useCallback, useState } from "react";
import SceneCamera from "@/components/playground/SceneCamera";
import SceneEnvironment from "@/components/playground/SceneEnvironment";
import PostProcessing from "@/components/playground/PostProcessing";
import type { SceneMode } from "@/components/playground/SceneContent";
import SkyDome from "@/components/skyDome/SkyDome";
import type { SkyPreset, SkyMode } from "@/components/skyDome/constants";
import GrassField from "@/components/grassField";
import { useGrassBreakdown } from "@/components/grassField/debug/GrassBreakdown";
import GrassLighting from "./GrassLighting";
import ShadowController from "./ShadowController";

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
  // Breakdown visualisers — all the scene-level debug lives in one place now.
  const { hideField, view } = useGrassBreakdown();

  // Re-bake the frozen shadow map once the field's model is ready.
  const [bakeSignal, setBakeSignal] = useState(0);
  const handleModelLoaded = useCallback(() => {
    setBakeSignal((n) => n + 1);
    onModelLoaded?.();
  }, [onModelLoaded]);

  return (
    <>
      {/* The "Grass ..." folder names aren't cosmetic: Leva's store is global and
          keyed by folder + control name, so sharing a folder with the water demo
          would mean sharing its values across a navigation. */}
      <SceneCamera folder="Grass Camera" azimuth={41} polar={73} radius={6.5} />
      <GrassLighting preset={activePreset} />
      <ShadowController rebakeSignal={bakeSignal} />
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
        {!hideField && (
          <GrassField
            preset={grassPreset}
            wireframe={mode === "Frame"}
            onLoaded={handleModelLoaded}
          />
        )}
        {view}
      </Suspense>
      <PostProcessing
        folder="Grass Postprocessing"
        defaults={{ intensity: 0.3, radius: 0.15, threshold: 0.06 }}
      />
    </>
  );
}
