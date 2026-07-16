"use client";

import { Suspense, useCallback, useState } from "react";
import SceneCamera from "@/components/playground/SceneCamera";
import SceneEnvironment from "@/components/playground/SceneEnvironment";
import PostProcessing from "@/components/playground/PostProcessing";
import type { SceneMode } from "@/components/playground/SceneContent";
import SkyDome from "@/components/skyDome/SkyDome";
import type { SkyPreset, SkyMode } from "@/components/skyDome/constants";
import { useControls } from "leva";
import GrassField from "@/components/GrassField";
import DebugScatter from "@/components/GrassField/debug/DebugScatter";
import DebugBlade from "@/components/GrassField/debug/DebugBlade";
import DebugMaskPlane from "@/components/GrassField/debug/DebugMaskPlane";
import DebugWind from "@/components/GrassField/debug/DebugWind";
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
  // Breakdown visualisers. Each one is off by default and can hide the field, so
  // a shot can be composed with nothing but the thing being explained.
  const { dbgScatter, dbgBlade, dbgMask, dbgWind, dbgHideField } = useControls(
    "Breakdown",
    {
      dbgScatter: { value: false, label: "Scatter (placement)" },
      dbgBlade: { value: false, label: "Single Blade" },
      dbgMask: { value: false, label: "Dirt Mask Plane" },
      dbgWind: { value: false, label: "Wind Field" },
      dbgHideField: { value: true, label: "Hide Grass Field" },
    },
  );

  // The wind plane is the one visualiser meant to be seen WITH the grass: the
  // bands crossing the ground are the gust the blades are leaning to.
  const anyDebug = dbgScatter || dbgBlade || dbgMask;
  const showField = !(anyDebug && dbgHideField);

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
        {showField && (
          <GrassField
            preset={grassPreset}
            wireframe={mode === "Frame"}
            onLoaded={handleModelLoaded}
          />
        )}
        {dbgScatter && <DebugScatter />}
        {dbgBlade && <DebugBlade />}
        {dbgMask && <DebugMaskPlane />}
        {dbgWind && <DebugWind />}
      </Suspense>
      <PostProcessing
        folder="Grass Postprocessing"
        defaults={{ intensity: 0.3, radius: 0.15, threshold: 0.06 }}
      />
    </>
  );
}
