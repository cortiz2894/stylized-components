"use client";

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useControls, button } from "leva";

// ─────────────────────────────────────────────────────────────────────────────
// ShadowController — bakes the directional shadow map once, then freezes it.
//
// Every shadow caster in this scene is effectively static: the rocks and trunks
// don't move, and the tree canopies cast a STATIC shadow (their depth material
// drops the wind — see makePineLeafDepthMaterial). So the shadow map is the same
// every frame, and re-rendering it 60×/second is pure waste — and worse, any
// jitter between those renders is exactly the flicker we're chasing.
//
// Turning autoUpdate off renders it on demand instead. The grass still RECEIVES
// shadows every frame (it reads the frozen map); only the map's re-render is
// skipped. A short re-bake window after the model signals ready covers the async
// GLB/texture load; the sun direction is scene-fixed, so nothing else needs one
// (a manual button is there for when the light is moved in dev).
// ─────────────────────────────────────────────────────────────────────────────

export default function ShadowController({
  /** Bumps when the field reports the model is ready — triggers a re-bake so the
   *  frozen map reflects the fully-loaded scene. */
  rebakeSignal = 0,
}: {
  rebakeSignal?: number;
}) {
  const gl = useThree((s) => s.gl);
  const bakeFrames = useRef(0);

  const { staticShadows } = useControls("Grass Shadows", {
    staticShadows: {
      value: true,
      label: "Static Shadows (freeze — no flicker)",
    },
    "Rebake Shadows": button(() => {
      bakeFrames.current = 8;
    }),
  });

  useEffect(() => {
    gl.shadowMap.autoUpdate = !staticShadows;
    if (staticShadows) {
      gl.shadowMap.needsUpdate = true;
      bakeFrames.current = 8;
    }
    return () => {
      // Leave the renderer as we found it for any other scene.
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, staticShadows]);

  // Re-bake when the scene finishes loading (casters + alpha textures settled).
  useEffect(() => {
    if (staticShadows) bakeFrames.current = 8;
  }, [rebakeSignal, staticShadows]);

  useFrame(() => {
    if (staticShadows && bakeFrames.current > 0) {
      // needsUpdate renders the shadow map once, then three clears it back to
      // false — so this bakes exactly `bakeFrames` frames and then stops.
      gl.shadowMap.needsUpdate = true;
      bakeFrames.current -= 1;
    }
  });

  return null;
}
