"use client";

import { Suspense, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import SceneCamera from "@/components/playground/SceneCamera";
import PostProcessing from "@/components/playground/PostProcessing";
import SkyDome from "@/components/skyDome/SkyDome";
import VolumetricLightFilter from "@/components/volumetricLight/VolumetricLightFilter";
import ClassroomRoom from "./ClassroomRoom";
import ClassroomLighting from "./ClassroomLighting";
import DustMotes from "./DustMotes";
import WindowShaftsFilter from "./WindowShaftsFilter";
import BreakdownHelpers from "./BreakdownHelpers";
import type { BreakdownState } from "./useBreakdownControls";
import type { RoomDebugView } from "./ClassroomRoom";
import {
  CLASSROOM_SKY_PRESETS,
  CLASSROOM_SUNSET,
  CLASSROOM_SUNSET_MODE,
} from "./classroomSky";
import { sunDirection } from "./classroomWindows";

/**
 * The shot: the back of the room, a little right of the aisle, at about seated
 * eye height, looking toward the blackboard with the windows running down the
 * left of frame. The reference's angle.
 *
 * A head-turn rather than an orbit — radius 0.5, so the target sits half a
 * unit in front of the eye and a drag turns the head instead of swinging the
 * camera across the room. The eye is at roughly (47.5, 2.6, -4.2).
 *
 * To re-frame: Leva → God Rays Camera → Framing → Free Camera, look around, "Copy Camera
 * JSON", paste here, and check the limits below still contain it.
 */
const SHOT = {
  azimuth: -150,
  polar: 89.5,
  radius: 0.5,
  target: [47.75, 2.6, -3.77] as [number, number, number],
  fov: 55,
};

/**
 * ── Two suns, on purpose ─────────────────────────────────────────────────────
 * The disc you see through the glass and the light that throws the patches
 * share an AZIMUTH but not an elevation, and that is a cheat worth naming.
 *
 * For the screen-space rays to fan out of the window, the disc has to be IN
 * frame — low, a few degrees over the horizon, framed by a pane. But a sun that
 * low sends its light almost flat across the room, over the desks and onto the
 * back wall: no slabs on the floor at all. The floor patches want it at 25–35°.
 *
 * So the disc stays where the composition needs it (Sky → Moon → Elevation) and the
 * light comes from higher up on the same bearing. Nobody reads the angle of a
 * patch on a floor against the height of a sun through a window; everybody
 * reads a room with no light on the floor.
 */
const DEFAULT_LIGHT_ELEVATION = 20;

/** The preset's own disc azimuth — only the first frame's guess, before
 *  SkyDome has reported where it actually put the disc. */
const DEFAULT_SUN_AZIMUTH = CLASSROOM_SUNSET.moonAzim ?? 53;

/** The breakdown's frame-wide view, as the room material's own debug switch. */
const ROOM_VIEW: Partial<Record<BreakdownState["view"], RoomDebugView>> = {
  albedo: 1,
  clay: 2,
  sun: 3,
};

interface GodRaysSceneContentProps {
  breakdown: BreakdownState;
}

export default function GodRaysSceneContent({
  breakdown,
}: GodRaysSceneContentProps) {
  const { view } = breakdown;
  const ssView = view === "ssMask" ? 1 : view === "ssRays" ? 2 : 0;
  // The two passes run back to back, so each one's "on its own" view needs the
  // OTHER one out of the way — the shafts would otherwise be added on top of
  // the screen-space mask, and vice versa. The world-space "Shafts Only" view
  // turns them on regardless of the layer toggle: asking to see them alone is
  // asking to see them.
  const screenSpaceOn = breakdown.screenSpace && view !== "shafts";
  const shaftsOn = (breakdown.shafts || view === "shafts") && ssView === 0;

  /** Disc POSITION, written by SkyDome — the screen-space rays march to it. */
  const sunPosRef = useRef(new THREE.Vector3(0, 1, 0));
  /** Disc DIRECTION, written by SkyDome — where the light's bearing comes from. */
  const discDirRef = useRef(
    sunDirection(CLASSROOM_SUNSET.moonElev ?? 7, DEFAULT_SUN_AZIMUTH),
  );
  /**
   * TOWARD the sun, as the LIGHT sees it. One vector, shared by reference with
   * the directional light, the dust and the shaft pass — all three read it, so
   * mutating it here moves all three together with nothing rebuilt.
   */
  const [sunDir] = useState(() =>
    sunDirection(DEFAULT_LIGHT_ELEVATION, DEFAULT_SUN_AZIMUTH),
  );

  const { lightElevation } = useControls("God Rays Sun", {
    lightElevation: {
      value: DEFAULT_LIGHT_ELEVATION,
      min: 2,
      max: 70,
      step: 0.5,
      label: "Light Elevation",
      hint: "Azimuth follows the disc (Sky → Moon → Azimuth)",
    },
  });

  useFrame(() => {
    const d = discDirRef.current;
    const azimuth = THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z));
    sunDirection(lightElevation, azimuth, sunDir);
  });

  return (
    <>
      {/* "God Rays ..." folders: Leva's store is global and keyed by folder +
          control name, so sharing a folder with another demo would share its
          values across a navigation. */}
      <SceneCamera
        folder="God Rays Camera"
        azimuth={SHOT.azimuth}
        polar={SHOT.polar}
        radius={SHOT.radius}
        target={SHOT.target}
        fov={SHOT.fov}
        rotateSpeed={0.3}
        zoomSpeed={1.2}
        zoomSmoothing={8}
        enablePan={false}
        limits={{
          // The dolly backs the eye away from the target. Past ~1.5 it walks
          // through the back wall, which is only 1.75 behind the shot.
          minDistance: 0.2,
          maxDistance: 1.5,
          minPolar: 65,
          maxPolar: 110,
          azimuthRange: 80,
        }}
      />

      {/* The sky outside the window. Its disc is placed from the Sky panel
          (Moon → Elevation / Azimuth); both refs below are what the rest of the
          scene reads back from it. */}
      <SkyDome
        extraPresets={CLASSROOM_SKY_PRESETS}
        defaultMode={CLASSROOM_SUNSET_MODE}
        moonPosRef={sunPosRef}
        moonDirRef={discDirRef}
      />

      <ClassroomLighting sunDir={sunDir} />

      <Suspense fallback={null}>
        <ClassroomRoom
          visible={breakdown.room}
          debugView={ROOM_VIEW[view] ?? 0}
        />
      </Suspense>

      <DustMotes
        sunDir={sunDir}
        active={breakdown.dust}
        debugView={breakdown.dustView}
      />

      <BreakdownHelpers
        sunDir={sunDir}
        panes={breakdown.panes}
        beams={breakdown.beams}
        ray={breakdown.ray}
        sunLines={breakdown.sunLines}
        raySamples={breakdown.raySamples}
        captureId={breakdown.captureId}
        xray={breakdown.xray}
      />

      <PostProcessing
        folder="God Rays Postprocessing"
        defaults={{ intensity: 0.35, radius: 0.88, threshold: 0.68 }}
        bloom={breakdown.bloom}
      >
        {/* ── Two kinds of god ray, and the order matters ─────────────────────
            Both read depth, so both go FIRST — see the composer's autoClear
            note: a depth reader past the second slot silently reads 1.0.

            The screen-space pass first. It only emits from SKY pixels, and it
            has to see the sky as the dome drew it, before the world-space
            shafts add light over the room. */}
        <VolumetricLightFilter
          folder="God Rays Screen-Space"
          sunDiscPosRef={sunPosRef}
          active={screenSpaceOn}
          debugView={ssView}
          defaults={{
            intensity: 2.33,
            tint: "#ffb877",
            tintMix: 0.4,
            density: 1,
            decay: 0.896,
            threshold: 0.3,
            skyOnly: 1,
            softness: 1,
            reach: 0.95,
            reachPow: 1.3,
            noiseAmount: 0.55,
            noiseScale: 7,
            noiseSpeed: 0.04,
          }}
        />
        {/* The beams IN the room: marched in world space through the window
            panes, and stopped by the depth buffer where they hit a desk or the
            floor. See WindowShaftsPass.

            OFF in the final look — the scene reads better without them — and
            kept mounted for the breakdown, where they are the clearest way to
            show what a volumetric march does. Breakdown → Layers → Window
            Shafts, or the "Shafts Only" view. */}
        <WindowShaftsFilter
          folder="God Rays Window Shafts"
          sunDir={sunDir}
          active={shaftsOn}
          debugView={view === "shafts" ? 1 : 0}
        />
      </PostProcessing>
    </>
  );
}
