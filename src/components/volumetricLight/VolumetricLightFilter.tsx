"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three";
import {
  VolumetricLightPass,
  type VolumetricLightOptions,
} from "./VolumetricLightPass";

// ─────────────────────────────────────────────────────────────────────────────
// <VolumetricLightFilter /> — the god-ray pass with a Leva panel, for use inside
// an <EffectComposer> from @react-three/postprocessing:
//
//   <EffectComposer>
//     <HeightFogFilter />            ← the air
//     <VolumetricLightFilter />      ← light THROUGH the air
//     <Bloom />                      ← glows off the shafts
//   </EffectComposer>
//
// ⚠ PUT THIS EARLY IN THE CHAIN. It reads the depth buffer to know what is
// standing between the camera and the sun, and `postprocessing` attaches the
// scene's depth texture to the composer's INITIAL input buffer. Every pass with
// `needsSwap` flips input and output, so a few passes in, the buffer holding
// that attachment is used as a render target and cleared — depth then reads back
// as 1.0, which this shader interprets as "open sky everywhere".
//
// The failure is silent and almost convincing: shafts still appear, they simply
// stop being blocked by anything, so the canopy no longer casts them and the
// whole frame washes out evenly. If the rays refuse to be occluded, this is why,
// and the fix is to move the pass earlier, not to touch the sky threshold.
//
// Every control is a uniform, so nothing here rebuilds the pass.
// ─────────────────────────────────────────────────────────────────────────────

interface VolumetricLightFilterProps {
  /** Leva folder. Kept per scene — Leva's store is global and keyed by folder
   *  plus control name, so two scenes sharing a folder share its VALUES. */
  folder?: string;
  /** Where the sun is. Feed it the SAME ref SkyDome writes its disc POSITION
   *  into (`moonPosRef`, not `moonDirRef`): the dome is centred on the camera
   *  lifted by its Y offset, so the bare direction points somewhere the disc is
   *  not. Without it the shafts have no origin and stay off. */
  sunDiscPosRef?: React.RefObject<THREE.Vector3>;
  defaults?: VolumetricLightOptions;
  /** A scene-level off switch on top of the panel's own — for a breakdown
   *  toggling layers from one place. Both have to be on. */
  active?: boolean;
  /** 0 = normal, 1 = the emitter mask, 2 = the shafts alone on black. */
  debugView?: 0 | 1 | 2;
}

export default function VolumetricLightFilter({
  folder: folderName = "Volumetric Light",
  sunDiscPosRef,
  defaults,
  active = true,
  debugView = 0,
}: VolumetricLightFilterProps) {
  const camera = useThree((s) => s.camera);
  const pass = useMemo(() => new VolumetricLightPass(defaults), []); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    enabled,
    intensity,
    tint,
    tintMix,
    density,
    decay,
    reach,
    reachPow,
    threshold,
    softness,
    skyOnly,
    samples,
    dither,
    noiseAmount,
    noiseScale,
    noiseSpeed,
  } = useControls(folderName, {
    enabled: { value: true, label: "God Rays" },
    intensity: {
      value: defaults?.intensity ?? 0.5,
      min: 0,
      max: 3,
      step: 0.01,
      label: "Intensity",
    },
    Colour: folder(
      {
        // The shafts arrive with the sky's OWN colour by default; this only
        // biases it. Pushing Tint Mix to 1 is how a scene gets shafts that
        // disagree with the sky it drew — occasionally what you want at night,
        // rarely what you want at noon.
        tint: {
          value: (defaults?.tint as string) ?? "#ffe6bd",
          label: "Tint",
        },
        tintMix: {
          value: defaults?.tintMix ?? 0.35,
          min: 0,
          max: 1,
          step: 0.01,
          label: "Tint Amount",
        },
      },
      { collapsed: false },
    ),
    Shafts: folder(
      {
        // How far along the pixel→sun line the march walks. Below 1 the shafts
        // stop short of the disc, which reads as separate beams; at 1 they all
        // converge into it and the sun becomes a star.
        density: {
          value: defaults?.density ?? 0.85,
          min: 0.1,
          max: 1,
          step: 0.01,
          label: "Length",
        },
        // Per-step falloff. This is what makes a shaft FADE along itself rather
        // than simply ending where the march ran out of steps.
        decay: {
          value: defaults?.decay ?? 0.965,
          min: 0.85,
          max: 1,
          step: 0.001,
          label: "Falloff",
        },
        // In screen heights from the disc. 1.6 puts the cut just off-frame, so
        // it does nothing until you bring it down — at which point it becomes
        // the "keep the rays near the sun" knob.
        reach: {
          value: defaults?.reach ?? 1.6,
          min: 0.2,
          max: 2.5,
          step: 0.05,
          label: "Reach",
        },
        reachPow: {
          value: defaults?.reachPow ?? 1.4,
          min: 0.5,
          max: 4,
          step: 0.1,
          label: "Reach Curve",
        },
      },
      { collapsed: false },
    ),
    Source: folder(
      {
        // What counts as light, in LINEAR units — the composer's buffers are
        // pre-tone-map, so a daylight sky that reads as 0.7 on screen is nearer
        // 0.4 here and the useful range of this slider is the bottom fifth.
        //
        // It is what makes one effect work across the whole day cycle: the
        // default sits under a lit sky and well over a night one, so switching
        // Sky Mode to night stops the shafts on its own, with nothing gating
        // the pass per preset. Raise it and the sky stops emitting entirely,
        // leaving only the disc — a much thinner, harder fan.
        threshold: {
          value: defaults?.threshold ?? 0.15,
          min: 0,
          max: 1.5,
          step: 0.01,
          label: "Light Threshold",
        },
        softness: {
          value: defaults?.softness ?? 0.3,
          min: 0.01,
          max: 1,
          step: 0.01,
          label: "Threshold Softness",
        },
        // 1 = only the sky emits, which is the physical case and the safe one.
        // Lower it and bright GEOMETRY starts throwing shafts too — a lantern,
        // a fire, a specular hit on water. Also the fastest way to make the
        // effect look wrong, since anything the bloom likes will now streak.
        skyOnly: {
          value: defaults?.skyOnly ?? 1,
          min: 0,
          max: 1,
          step: 0.05,
          label: "Sky Only",
        },
      },
      { collapsed: true },
    ),
    Dust: folder(
      {
        // Breaks the fan into separate beams. At 0 the shafts are a perfectly
        // even radial blur, which is the tell that gives away a screen-space
        // effect — real shafts are uneven because the air is.
        noiseAmount: {
          value: defaults?.noiseAmount ?? 0.35,
          min: 0,
          max: 1,
          step: 0.01,
          label: "Amount",
        },
        noiseScale: {
          value: defaults?.noiseScale ?? 6,
          min: 1,
          max: 30,
          step: 0.5,
          label: "Beam Count",
        },
        noiseSpeed: {
          value: defaults?.noiseSpeed ?? 0.05,
          min: 0,
          max: 0.5,
          step: 0.005,
          label: "Drift",
        },
      },
      { collapsed: true },
    ),
    Quality: folder(
      {
        // A quality knob and nothing else: the march is normalised by the
        // weights it actually used, so moving this changes how smooth the
        // shafts are, never how bright.
        samples: {
          value: defaults?.samples ?? 40,
          min: 8,
          max: 64,
          step: 1,
          label: "Samples",
        },
        // Trades banding for grain. At 0 a low sample count draws the march as
        // visible concentric arcs; the bloom that follows hides most of what
        // this adds instead.
        dither: {
          value: defaults?.dither ?? 1,
          min: 0,
          max: 1,
          step: 0.05,
          label: "Dither",
        },
      },
      { collapsed: true },
    ),
  });

  // The pass needs the scene camera to project the sun onto the screen.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    pass.sceneCamera = camera;
  }, [pass, camera]);

  useEffect(() => {
    // Writing onto the memoised pass: all of this is uniforms and a flag, so a
    // slider drag costs nothing and rebuilds nothing.
    /* eslint-disable react-hooks/immutability */
    const u = pass.uniforms;
    const m = pass.maskUniforms;
    // No sun ref means no origin to march toward — (0, 1, 0) would put the fan
    // over the world origin, which is a strange bug to have to diagnose. Off is
    // the honest state.
    pass.enabled = enabled && active && !!sunDiscPosRef;
    u.uDebugView.value = debugView;
    u.uIntensity.value = intensity;
    (u.uTint.value as THREE.Color).set(tint);
    u.uTintMix.value = tintMix;
    u.uDensity.value = density;
    u.uDecay.value = decay;
    u.uReach.value = reach;
    u.uReachPow.value = reachPow;
    u.uSamples.value = samples;
    u.uDither.value = dither;
    u.uNoiseAmount.value = noiseAmount;
    u.uNoiseScale.value = noiseScale;
    u.uNoiseSpeed.value = noiseSpeed;
    m.uThreshold.value = threshold;
    m.uSoftness.value = softness;
    m.uSkyOnly.value = skyOnly;
    /* eslint-enable react-hooks/immutability */
  }, [
    pass,
    enabled,
    active,
    debugView,
    sunDiscPosRef,
    intensity,
    tint,
    tintMix,
    density,
    decay,
    reach,
    reachPow,
    threshold,
    softness,
    skyOnly,
    samples,
    dither,
    noiseAmount,
    noiseScale,
    noiseSpeed,
  ]);

  useFrame((state) => {
    /* eslint-disable react-hooks/immutability */
    // Where the sun is THIS frame. SkyDome rewrites it every frame — the disc
    // moves with the sky mode and the dome follows the camera — so it is read
    // here rather than in an effect.
    if (sunDiscPosRef?.current) {
      pass.sunWorldPosition.copy(sunDiscPosRef.current);
    }
    // Only the strands move, so a scene with them off pays nothing.
    if (noiseAmount > 0.001) pass.time = state.clock.elapsedTime;
    /* eslint-enable react-hooks/immutability */
  });

  useEffect(() => () => pass.dispose(), [pass]);

  return <primitive object={pass} dispose={null} />;
}
