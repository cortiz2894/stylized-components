"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three";
import {
  MAX_STEPS,
  WindowShaftsPass,
  type WindowShaftsOptions,
} from "./WindowShaftsPass";

interface WindowShaftsFilterProps {
  /** TOWARD the sun — the same vector the light and the dust read. The pass
   *  holds a reference to it, so mutating it moves the beams with no rebuild. */
  sunDir: THREE.Vector3;
  folder?: string;
  defaults?: WindowShaftsOptions;
  /** Scene-level off switch on top of the panel's own (the breakdown's). */
  active?: boolean;
  /** 0 = normal, 1 = the shafts alone on black. */
  debugView?: 0 | 1;
}

/**
 * <WindowShaftsPass /> with a Leva panel, for use inside the composer.
 *
 * It reads depth, so the same rule as the fog and the screen-space rays
 * applies: keep it among the first passes. See PostProcessing's `autoClear`.
 */
export default function WindowShaftsFilter({
  sunDir,
  folder: folderName = "Window Shafts",
  defaults,
  active = true,
  debugView = 0,
}: WindowShaftsFilterProps) {
  const camera = useThree((s) => s.camera);
  const pass = useMemo(() => new WindowShaftsPass(sunDir, defaults), []); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    enabled,
    intensity,
    color,
    density,
    fade,
    edgeSoftness,
    penumbra,
    noiseAmount,
    noiseScale,
    noiseSpeed,
    steps,
    jitter,
  } = useControls(folderName, {
    enabled: { value: true, label: "Window Shafts" },
    intensity: {
      value: defaults?.intensity ?? 0.37,
      min: 0,
      max: 5,
      step: 0.01,
      label: "Intensity",
    },
    color: { value: (defaults?.color as string) ?? "#e5973d", label: "Color" },
    Beam: folder({
      density: {
        value: defaults?.density ?? 0.2,
        min: 0,
        max: 1,
        step: 0.005,
        label: "Density",
      },
      fade: {
        value: defaults?.fade ?? 0.03,
        min: 0,
        max: 0.5,
        step: 0.001,
        label: "Fade Into Room",
      },
      edgeSoftness: {
        value: defaults?.edgeSoftness ?? 0,
        min: 0,
        max: 1,
        step: 0.005,
        label: "Edge Softness",
      },
      penumbra: {
        value: defaults?.penumbra ?? 0,
        min: 0,
        max: 0.2,
        step: 0.001,
        label: "Penumbra",
      },
    }),
    Sampling: folder(
      {
        steps: {
          value: defaults?.steps ?? 40,
          min: 1,
          max: MAX_STEPS,
          step: 1,
          label: "Steps",
        },
        jitter: { value: true, label: "Jitter" },
      },
      { collapsed: true },
    ),
    Dust: folder(
      {
        noiseAmount: {
          value: defaults?.noiseAmount ?? 0.5,
          min: 0,
          max: 1,
          step: 0.01,
          label: "Amount",
        },
        noiseScale: {
          value: defaults?.noiseScale ?? 0.6,
          min: 0.05,
          max: 4,
          step: 0.01,
          label: "Scale",
        },
        noiseSpeed: {
          value: defaults?.noiseSpeed ?? 0.08,
          min: 0,
          max: 1,
          step: 0.005,
          label: "Drift",
        },
      },
      { collapsed: true },
    ),
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    pass.sceneCamera = camera;
  }, [pass, camera]);

  useEffect(() => {
    /* eslint-disable react-hooks/immutability */
    const u = pass.uniforms;
    pass.enabled = enabled && active;
    u.uDebugView.value = debugView;
    u.uSteps.value = steps;
    u.uJitter.value = jitter ? 1 : 0;
    u.uIntensity.value = intensity;
    (u.uLightColor.value as THREE.Color).set(color);
    u.uDensity.value = density;
    u.uFade.value = fade;
    u.uEdgeSoftness.value = edgeSoftness;
    u.uPenumbra.value = penumbra;
    u.uNoiseAmount.value = noiseAmount;
    u.uNoiseScale.value = noiseScale;
    u.uNoiseSpeed.value = noiseSpeed;
    /* eslint-enable react-hooks/immutability */
  }, [
    pass,
    enabled,
    active,
    debugView,
    steps,
    jitter,
    intensity,
    color,
    density,
    fade,
    edgeSoftness,
    penumbra,
    noiseAmount,
    noiseScale,
    noiseSpeed,
  ]);

  useFrame((state) => {
    // eslint-disable-next-line react-hooks/immutability
    pass.uniforms.uTime.value = state.clock.elapsedTime;
  });

  useEffect(() => () => pass.dispose(), [pass]);

  return <primitive object={pass} dispose={null} />;
}
