"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PCFShadowMap } from "three";
import { Leva } from "leva";
import AdaptiveResolution, {
  usePerformanceControls,
} from "@/components/shared/AdaptiveResolution";
import { LEVA_THEME } from "@/components/shared/theme";
import UIOverlay from "@/components/overlay/UIOverlay";
import OverlayButtons from "@/components/overlay/OverlayButtons";
import LoadingOverlay from "@/components/overlay/LoadingOverlay";
import { useSceneReady } from "@/components/overlay/useSceneReady";
import { useImmersive } from "@/components/overlay/useImmersive";
import { useIsMobile } from "@/components/shared/useIsMobile";
import GodRaysSceneContent from "./GodRaysSceneContent";
import { useBreakdownControls } from "./useBreakdownControls";
import { CAMERA_FAR, CLASSROOM_SUNSET } from "./classroomSky";

export default function GodRaysCanvas() {
  // Two god-ray passes that are both fixed costs PER PIXEL — the screen-space
  // march and the world-space one — so the dpr is the lever that matters most
  // here, and a phone's native ratio is the wrong one to honour.
  const isMobile = useIsMobile();

  /** Only ever scaled BELOW the ceiling on the Canvas, never above it. */
  const [resScale, setResScale] = useState(1);

  const [hideLeva, setHideLeva] = useState(true);
  const { immersive, toggle: toggleImmersive } = useImmersive();

  const dpr = (isMobile ? 0.8 : 1.5) * resScale;

  // A 6.6MB GLB, so this is a real wait: the loader stays up until the
  // classroom has arrived rather than showing an empty sky.
  const sceneReady = useSceneReady();

  // "God Rays Performance", not "Performance": Leva's store is global and keyed
  // by folder + control name, so sharing a folder would share the value across
  // a navigation.
  const perf = usePerformanceControls("God Rays Performance");

  // The recording panel — views, layers and helpers for the video. See
  // useBreakdownControls.
  const breakdown = useBreakdownControls();
  // The DOM grade is part of the FINAL image only: over a debug view it would
  // tint a mask violet and darken its corners, which explains nothing.
  const showGrade = breakdown.grade && breakdown.view === "final";

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
          // PCF with a radius: three r182 folds PCFSoft into PCF, and the
          // light's Softness slider is the radius. The window frames' shadows
          // are the whole floor pattern, so they want a slightly soft edge
          // rather than a stair-stepped one.
          shadows={{ type: PCFShadowMap }}
          camera={{
            position: [47.5, 2.6, -4.2],
            fov: 55,
            near: 0.1,
            far: CAMERA_FAR,
          }}
          gl={{ antialias: true, alpha: false }}
          dpr={dpr}
          style={{ background: CLASSROOM_SUNSET.skyHigh }}
        >
          <AdaptiveResolution settings={perf} onScale={setResScale} />
          <GodRaysSceneContent breakdown={breakdown} />
        </Canvas>

        {/* A lens vignette. Multiply, so it can only take light away and never
            tints the middle — the reference's corners fall off into the dark
            of the room, which is most of what frames the windows. */}
        <div
          style={{
            display: showGrade ? undefined : "none",
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(125% 100% at 45% 45%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.25) 85%, rgba(0,0,0,0.45) 100%)",
            mixBlendMode: "multiply",
            pointerEvents: "none",
          }}
        />
        {/* The last thing over the frame: a colour-blend wash that pulls the
            GLB's warm browns into the dusk's violet. See `filter` in
            classroomSky.ts. */}
        <div
          style={{
            display: showGrade ? undefined : "none",
            position: "absolute",
            inset: 0,
            backgroundColor: CLASSROOM_SUNSET.filter.color,
            opacity: CLASSROOM_SUNSET.filter.opacity,
            mixBlendMode: "color",
            pointerEvents: "none",
          }}
        />
      </div>
      {/* "Background" as a constant: there is no wireframe mode in this scene,
          and a dropdown that does nothing is worse than no dropdown. */}
      {!immersive && (
        <UIOverlay
          mode="Background"
          title="GOD RAYS"
          subtitle="Sunset light through a classroom window"
        />
      )}
      <OverlayButtons
        hideLeva={hideLeva}
        onToggleLeva={() => setHideLeva((v) => !v)}
        immersive={immersive}
        onToggleImmersive={toggleImmersive}
      />
      <LoadingOverlay visible={!sceneReady} />
    </>
  );
}
