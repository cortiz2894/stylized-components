"use client";

import { useEffect, useRef } from "react";
import { useHelper } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three";
import { CLASSROOM_SUNSET } from "./classroomSky";
import { ROOM_CENTER } from "./classroomWindows";

interface ClassroomLightingProps {
  /** TOWARD the sun, normalised. The same vector the dust and the shafts read,
   *  which is what keeps the floor patches and the beams landing together. */
  sunDir: THREE.Vector3;
  folder?: string;
}

/**
 * One hot key through the windows and a dim violet everything-else.
 *
 * Not PresetLighting, because that component owns its own direction sliders —
 * and in this scene the sun's direction is shared by four things (this light,
 * the disc in the sky, the dust and the shafts). One panel has to own it, and
 * a second set of sliders here would be a second answer that drifts.
 *
 * ── The shadow rig IS the effect ─────────────────────────────────────────────
 * The window wall is solid geometry, so every bit of sun inside the room is
 * light that got through the glass — the patches on the floor are nothing but
 * this map. It is sized to the room rather than to the world: a texel is
 * (2 × camSize) / mapSize, and at 20 / 4096 that is about a centimetre, which
 * is what keeps the mullions' shadows thin lines instead of soft smears.
 */
export default function ClassroomLighting({
  sunDir,
  folder: folderName = "God Rays Lighting",
}: ClassroomLightingProps) {
  const dirRef = useRef<THREE.DirectionalLight>(null!);

  const {
    ambientColor,
    ambientIntensity,
    hemiSky,
    hemiGround,
    hemiIntensity,
    sunColor,
    sunIntensity,
    mapSize,
    camSize,
    bias,
    normalBias,
    shadowRadius,
    showHelper,
  } = useControls(folderName, {
    Ambient: folder({
      ambientColor: {
        value: CLASSROOM_SUNSET.light.ambientColor,
        label: "Color",
      },
      ambientIntensity: {
        value: CLASSROOM_SUNSET.light.ambientIntensity,
        min: 0,
        max: 5,
        step: 0.01,
        label: "Intensity",
      },
      // A hemisphere on top of the flat ambient: the ceiling a touch cooler
      // than the floor, which is the one cue that stops the dark half of the
      // room reading as a flat fill.
      hemiSky: { value: "#6f68b8", label: "Hemi Sky" },
      hemiGround: { value: "#3a2530", label: "Hemi Ground" },
      hemiIntensity: {
        value: 0.74,
        min: 0,
        max: 5,
        step: 0.01,
        label: "Hemi Intensity",
      },
    }),
    Sun: folder({
      sunColor: { value: CLASSROOM_SUNSET.light.dirColor, label: "Color" },
      sunIntensity: {
        value: CLASSROOM_SUNSET.light.dirIntensity,
        min: 0,
        max: 15,
        step: 0.05,
        label: "Intensity",
      },
    }),
    Shadow: folder(
      {
        mapSize: {
          value: 4096,
          options: [1024, 2048, 4096, 8192],
          label: "Map Size",
        },
        camSize: {
          value: 20,
          min: 5,
          max: 60,
          step: 0.5,
          label: "Cam Size",
        },
        bias: {
          value: -0.0004,
          min: -0.01,
          max: 0.01,
          step: 0.0001,
          label: "Bias",
        },
        normalBias: {
          value: 0.025,
          min: 0,
          max: 0.2,
          step: 0.001,
          label: "Normal Bias",
        },
        shadowRadius: {
          value: 2,
          min: 0,
          max: 10,
          step: 0.1,
          label: "Softness",
        },
        showHelper: { value: false, label: "Show Helper" },
      },
      { collapsed: true },
    ),
  });

  // The light sits along the sun direction from the middle of the room. Its
  // distance only has to clear the room, since a directional light's position
  // is irrelevant to shading — it is where the shadow camera starts.
  //
  // Per frame rather than in an effect: `sunDir` is one shared vector the scene
  // MUTATES, so there is no new value for a dependency list to notice.
  useFrame(() => {
    const light = dirRef.current;
    const [cx, cy, cz] = ROOM_CENTER;
    light.position.set(
      cx + sunDir.x * 40,
      cy + sunDir.y * 40,
      cz + sunDir.z * 40,
    );
    light.target.position.set(cx, cy, cz);
    light.target.updateMatrixWorld();
  });

  useEffect(() => {
    const light = dirRef.current;
    const cam = light.shadow.camera;
    cam.left = -camSize;
    cam.right = camSize;
    cam.top = camSize;
    cam.bottom = -camSize;
    cam.near = 1;
    cam.far = 100;
    cam.updateProjectionMatrix();
    light.shadow.bias = bias;
    light.shadow.normalBias = normalBias;
    light.shadow.radius = shadowRadius;
    if (light.shadow.mapSize.x !== mapSize) {
      light.shadow.mapSize.set(mapSize, mapSize);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  }, [camSize, bias, normalBias, shadowRadius, mapSize]);

  useHelper(showHelper && dirRef, THREE.DirectionalLightHelper, 1, sunColor);

  return (
    <>
      <ambientLight color={ambientColor} intensity={ambientIntensity} />
      <hemisphereLight
        color={hemiSky}
        groundColor={hemiGround}
        intensity={hemiIntensity}
      />
      <directionalLight
        ref={dirRef}
        color={sunColor}
        intensity={sunIntensity}
        castShadow
      />
    </>
  );
}
