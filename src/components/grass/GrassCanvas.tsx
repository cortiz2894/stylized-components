"use client";

import { useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { PCFSoftShadowMap } from "three";
import { Leva, useControls } from "leva";
import { LEVA_THEME } from "@/components/shared/theme";
import type { SceneMode } from "@/components/playground/SceneContent";
import UIOverlay from "@/components/overlay/UIOverlay";
import OverlayButtons from "@/components/overlay/OverlayButtons";
import LoadingOverlay from "@/components/overlay/LoadingOverlay";
import { SKY_PRESETS, type SkyPreset } from "@/components/skyDome/constants";
import GrassSceneContent from "./GrassSceneContent";
import PresetSwitcher from "./PresetSwitcher";

// Must clear the SkyDome radius (Leva "Sky > Dome Radius", default 900) or the
// dome is clipped away by the far plane and the backdrop goes flat.
const CAMERA_FAR = 3000;

export default function GrassCanvas() {
  const [hideLeva, setHideLeva] = useState(true);
  const [isLoadingModel, setIsLoadingModel] = useState(true);

  // Active sky preset — SkyDome reports it on mount and on every Sky Mode
  // change. It drives the lighting rig and the full-screen color filter, so the
  // whole scene takes on the mood of the selected sky.
  const [activePreset, setActivePreset] = useState<SkyPreset>(SKY_PRESETS.day);

  // Grass "season" preset, picked from the overlay. Only pushes values into the
  // Leva panel, so it can still be tweaked freely afterwards.
  const [grassPreset, setGrassPreset] = useState("default");

  const handleModelLoaded = useCallback(() => {
    setIsLoadingModel(false);
  }, []);

  const handlePresetChange = useCallback((preset: SkyPreset) => {
    setActivePreset(preset);
  }, []);

  const { mode } = useControls("Scene", {
    mode: {
      value: "Background" as SceneMode,
      options: ["Background", "Frame"] as SceneMode[],
      label: "Mode",
    },
  });

  return (
    <>
      <Leva
        theme={LEVA_THEME}
        titleBar={{ title: "CONTROLS" }}
        collapsed={false}
        flat={false}
        oneLineLabels={false}
        hidden={hideLeva}
      />
      <div style={{ position: "fixed", inset: 0 }}>
        <Canvas
          // PCF Soft instead of the default PCF: the blades and flower stems are
          // thinner than a shadow-map texel, so their shadows come out as hard
          // stair-stepped streaks. The wider filter kernel dissolves the texel
          // edges into a soft shadow, which is also the look this scene wants.
          shadows={{ type: PCFSoftShadowMap }}
          camera={{ position: [8, 6, 8], fov: 50, near: 0.1, far: CAMERA_FAR }}
          gl={{ antialias: true, alpha: false }}
          dpr={1.2}
          style={{ background: "#0d1a10" }}
        >
          <GrassSceneContent
            mode={mode}
            activePreset={activePreset}
            onPresetChange={handlePresetChange}
            grassPreset={grassPreset}
            onModelLoaded={handleModelLoaded}
          />
        </Canvas>

        {/* Sky preset color filter — tints the whole frame toward the preset's
            mood without touching any material. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: activePreset.filter.color,
            opacity: activePreset.filter.opacity,
            mixBlendMode: "color",
            pointerEvents: "none",
          }}
        />
      </div>
      <UIOverlay
        mode={mode}
        title="STYLIZED GRASS"
        subtitle="Wind-animated stylized grass field"
      />
      <PresetSwitcher active={grassPreset} onSelect={setGrassPreset} />
      <OverlayButtons
        hideLeva={hideLeva}
        onToggleLeva={() => setHideLeva((v) => !v)}
      />
      <LoadingOverlay visible={isLoadingModel} />
    </>
  );
}
