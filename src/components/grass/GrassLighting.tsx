"use client";

import { useEffect, useRef } from "react";
import { useHelper } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three";
import type { SkyPreset } from "@/components/skyDome/constants";

// ─────────────────────────────────────────────────────────────────────────────
// GrassLighting — preset-driven ambient + directional rig.
//
// Color and intensity come from the active sky preset's `light` block: when the
// Sky Mode changes, the Leva sliders snap to the preset's values and stay freely
// tweakable afterwards.
//
// The sun DIRECTION, however, is a property of this scene, not of the preset —
// the presets' dirX/Y/Z are authored for a much larger world and would swing the
// sun somewhere that doesn't frame these rocks. So the direction below stays put
// across Sky Modes; the light is placed along it at `lightDistance` from the
// origin, which keeps the shadow camera tight (and the shadow map dense enough
// to avoid acne).
// ─────────────────────────────────────────────────────────────────────────────

interface GrassLightingProps {
  preset: SkyPreset;
}

export default function GrassLighting({ preset }: GrassLightingProps) {
  const dirRef = useRef<THREE.DirectionalLight>(null!);
  const ambientRef = useRef<THREE.AmbientLight>(null!);

  const [{ ambientColor, ambientIntensity }, setAmbient] = useControls(
    "Grass Lighting",
    () => ({
      Ambient: folder(
        {
          ambientColor: { value: "#f5e7c3", label: "Color" },
          ambientIntensity: {
            value: 1,
            min: 0,
            max: 5,
            step: 0.05,
            label: "Intensity",
          },
        },
        { collapsed: false },
      ),
    }),
  );

  const [
    {
      dirColor,
      dirIntensity,
      dirX,
      dirY,
      dirZ,
      lightDistance,
      castShadow,
      shadowMapSize,
      shadowCamSize,
      shadowNear,
      shadowFar,
      shadowBias,
      shadowNormalBias,
      showHelper,
    },
    setDir,
  ] = useControls("Grass Lighting", () => ({
    Directional: folder(
      {
        dirColor: { value: "#ffffff", label: "Color" },
        dirIntensity: {
          value: 3,
          min: 0,
          max: 10,
          step: 0.1,
          label: "Intensity",
        },
        dirX: { value: -55.0, min: -200, max: 200, step: 0.5, label: "Dir X" },
        dirY: { value: 21.5, min: -50, max: 200, step: 0.5, label: "Dir Y" },
        dirZ: { value: -11.5, min: -200, max: 200, step: 0.5, label: "Dir Z" },
        lightDistance: {
          value: 60,
          min: 5,
          max: 200,
          step: 1,
          label: "Light Distance",
        },
      },
      { collapsed: false },
    ),
    Shadow: folder(
      {
        castShadow: { value: true, label: "Cast Shadow" },
        shadowMapSize: {
          value: 4096,
          options: [512, 1024, 2048, 4096],
          label: "Shadow Map",
        },
        // A texel covers (2 × camSize) / mapSize world units, so this is the
        // strongest lever on shadow crispness: every unit of slack around the
        // scene is texels spent shadowing empty space. The grass floor is ~7.4
        // units in radius, so 9 wraps it with little to spare — at 4096 that is
        // ~4mm per texel, fine enough to resolve blades and flower stems.
        shadowCamSize: {
          value: 9,
          min: 2,
          max: 100,
          step: 0.5,
          label: "Shadow Cam Size (smaller = sharper)",
        },
        shadowNear: { value: 1, min: 0.1, max: 50, step: 0.1, label: "Near" },
        shadowFar: { value: 120, min: 10, max: 500, step: 5, label: "Far" },
        // Acne guards: normalBias offsets the sample along the surface normal
        // (fixes the moiré on the rocks' curved faces), bias nudges depth.
        shadowBias: {
          value: 0.0,
          min: -0.01,
          max: 0.01,
          step: 0.0001,
          label: "Bias",
        },
        shadowNormalBias: {
          value: 0.22,
          min: 0,
          max: 1,
          step: 0.005,
          label: "Normal Bias",
        },
        showHelper: { value: false, label: "Show Helper" },
      },
      { collapsed: true },
    ),
  }));

  // ── Preset → Leva ─────────────────────────────────────────────────────────
  useEffect(() => {
    const l = preset.light;
    setAmbient({
      ambientColor: l.ambientColor,
      ambientIntensity: l.ambientIntensity,
    });

    // Only color + intensity: the sun direction is scene-owned (see header).
    const dirUpdate: Record<string, unknown> = {
      dirColor: l.dirColor,
      dirIntensity: l.dirIntensity,
    };
    const s = preset.shadow;
    if (s?.shadowBias !== undefined) dirUpdate.shadowBias = s.shadowBias;
    if (s?.shadowNormalBias !== undefined)
      dirUpdate.shadowNormalBias = s.shadowNormalBias;
    if (s?.shadowNear !== undefined) dirUpdate.shadowNear = s.shadowNear;
    if (s?.shadowFar !== undefined) dirUpdate.shadowFar = s.shadowFar;
    if (s?.shadowCamSize !== undefined)
      dirUpdate.shadowCamSize = s.shadowCamSize;
    if (s?.shadowMapSize !== undefined)
      dirUpdate.shadowMapSize = s.shadowMapSize;
    setDir(dirUpdate);
  }, [preset, setAmbient, setDir]);

  useHelper(showHelper && dirRef, THREE.DirectionalLightHelper, 1, dirColor);

  // Preset direction, rescaled to this scene's size.
  const dir = new THREE.Vector3(dirX, dirY, dirZ);
  if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
  dir.normalize().multiplyScalar(lightDistance);

  useFrame(() => {
    const dl = dirRef.current;
    if (!dl) return;
    // Target stays at the origin (the grass floor is centred there).
    dl.target.position.set(0, 0, 0);
    dl.target.updateMatrixWorld();
  });

  return (
    <>
      <ambientLight
        ref={ambientRef}
        color={ambientColor}
        intensity={ambientIntensity}
      />
      <directionalLight
        ref={dirRef}
        color={dirColor}
        intensity={dirIntensity}
        position={[dir.x, dir.y, dir.z]}
        castShadow={castShadow}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={shadowNear}
        shadow-camera-far={shadowFar}
        shadow-camera-left={-shadowCamSize}
        shadow-camera-right={shadowCamSize}
        shadow-camera-top={shadowCamSize}
        shadow-camera-bottom={-shadowCamSize}
        shadow-bias={shadowBias}
        shadow-normalBias={shadowNormalBias}
      />
    </>
  );
}
