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
import { useImmersive } from "@/components/overlay/useImmersive";
import {
  SKY_PRESETS,
  type SkyPreset,
  type SkyMode,
} from "@/components/skyDome/constants";
import { GRASS_PRESETS } from "@/components/grassField/presets";
import GrassSceneContent from "./GrassSceneContent";
import OverlaySwitcher from "./OverlaySwitcher";

// Skies offered in the overlay. SkyDome's own Leva dropdown still lists every
// preset — this is the short list worth a one-click switch.
const SKY_CHOICES: SkyMode[] = ["day", "sunset", "night"];

// Must clear the SkyDome radius (Leva "Sky > Dome Radius", default 900) or the
// dome is clipped away by the far plane and the backdrop goes flat.
const CAMERA_FAR = 3000;

export default function GrassCanvas() {
  const [hideLeva, setHideLeva] = useState(true);
  const [isLoadingModel, setIsLoadingModel] = useState(true);
  const { immersive, toggle: toggleImmersive } = useImmersive();

  // Active sky preset — SkyDome reports it on mount and on every Sky Mode
  // change. It drives the lighting rig and the full-screen color filter, so the
  // whole scene takes on the mood of the selected sky.
  const [activePreset, setActivePreset] = useState<SkyPreset>(SKY_PRESETS.day);

  // Grass "season" preset, picked from the overlay. Only pushes values into the
  // Leva panel, so it can still be tweaked freely afterwards.
  const [grassPreset, setGrassPreset] = useState("default");

  // Sky picked from the overlay. Handed to SkyDome as targetMode, which routes it
  // through the same path as its Leva dropdown — so lighting and the color filter
  // follow along, exactly as if the dropdown had been used.
  const [skyMode, setSkyMode] = useState<SkyMode>("day");

  const handleModelLoaded = useCallback(() => {
    setIsLoadingModel(false);
  }, []);

  const handlePresetChange = useCallback((preset: SkyPreset) => {
    setActivePreset(preset);
  }, []);

  // "Grass Scene", not "Scene": the water demo owns "Scene" in Leva's global
  // store, and sharing the folder would share the value across a navigation.
  const { mode } = useControls("Grass Scene", {
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
        hidden={hideLeva || immersive}
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
          dpr={1}
          style={{ background: "#0d1a10" }}
        >
          <GrassSceneContent
            mode={mode}
            activePreset={activePreset}
            onPresetChange={handlePresetChange}
            grassPreset={grassPreset}
            skyMode={skyMode}
            onModelLoaded={handleModelLoaded}
          />
        </Canvas>
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
      {!immersive && (
        <UIOverlay
          mode={mode}
          title="STYLIZED GRASS"
          subtitle="Wind-animated stylized grass field"
        />
      )}
      {!immersive && (
        <OverlaySwitcher
          rows={[
            {
              label: "Season",
              active: grassPreset,
              onSelect: setGrassPreset,
              options: Object.entries(GRASS_PRESETS).map(([key, p]) => ({
                key,
                label: p.label,
              })),
            },
            {
              label: "Sky",
              active: skyMode,
              onSelect: (key) => setSkyMode(key as SkyMode),
              options: SKY_CHOICES.map((key) => ({
                key,
                label: SKY_PRESETS[key].label,
              })),
            },
          ]}
        />
      )}
      <OverlayButtons
        hideLeva={hideLeva}
        onToggleLeva={() => setHideLeva((v) => !v)}
        immersive={immersive}
        onToggleImmersive={toggleImmersive}
      />
      <LoadingOverlay visible={isLoadingModel} />
    </>
  );
}
