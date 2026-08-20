"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer } from "@react-three/postprocessing";
import { Leva, useControls } from "leva";
import { PCFSoftShadowMap } from "three";
import KuwaharaFilter from "@/components/kuwahara/KuwaharaFilter";
import {
  OutlinePass,
  useOutlineControls,
  OUTLINE_SOURCE,
} from "@/components/outline/OutlineFilter";
import WatercolorFilter from "@/components/watercolor/WatercolorFilter";
import { LEVA_THEME } from "@/components/shared/theme";

// ─────────────────────────────────────────────────────────────────────────────
// The painterly filter, on the smallest scene that still shows what it does.
//
// This is the "copy this" version — one file, no castle, no fog, no bloom, no
// lens flare, no adaptive resolution. Everything here that is not the filter is
// here for a reason you can see on screen:
//
//   · a TORUS KNOT, because its surface turns through every orientation at
//     once, so the brush strokes visibly rotate to follow the form. A cube
//     would only ever show you three of them.
//   · a SHADOW-ONLY GROUND, because the filter's behaviour on a flat region is
//     half the story and a knot alone has none. In the Anisotropy debug view
//     the empty floor reads black (no flow, round kernel) against the knot's
//     bright silhouette (strong flow, stretched kernel) — that one frame
//     explains the word "anisotropic" better than a diagram.
//
// ── Why this looks WEAKER than the castle demo ───────────────────────────────
//
// It is the same filter with the same numbers, and the difference is worth
// understanding before reaching for the sliders:
//
//   1. The brush is measured in PIXELS. Render the same scene at twice the
//      device pixel ratio and the stroke covers a quarter of the area, so the
//      effect looks half as strong and costs four times as much. R3F's default
//      `dpr` is [1, 2] — i.e. 2 on any retina display — which is why this file
//      pins it to 1. That is also the single biggest lever on the fan noise.
//   2. Kuwahara flattens VARIANCE. A smooth-shaded solid-colour object barely
//      has any, so there is little for it to flatten; the castle scene is full
//      of blossom, tiles and beams, and high-frequency detail is what the
//      filter turns into visible brushwork.
//   3. The castle is not only the Kuwahara. It also runs the WATERCOLOUR GRADE
//      below, plus height fog, bloom and a CSS colour overlay. A good part of
//      those flat pastel patches is the grade's quantiser, not the paint —
//      which is why the grade is in here too, on its own switch.
//
// ── The three filters, and why they sit in this order ────────────────────────
//
//   OUTLINE    edge-detects the render and lays ink on it.
//   KUWAHARA   reorganises the image — it decides where the flat patches are
//              and which way the strokes run. Geometry, effectively. Because it
//              runs after the ink, it paints the ink too.
//   WATERCOLOUR grades it — quantises the value into bands, tints the shadows,
//              saturates, tone maps, then multiplies paper over the lot. It
//              changes what colour every pixel is, not where anything is.
//
// Ink before paint is a look decision, and the reason is in OutlineFilter's
// header: ink drawn after the paint is never touched again and comes out
// vector-clean, while ink drawn before gets stroked by the brush along with
// everything else. Swapping these two lines is a legitimate thing to try.
//
// Grade last is NOT a look decision. It ends in an ACES curve, and a tone map
// is only a tone map if nothing adds light after it.
//
// Each has its own off switch, so any subset can be seen alone. Kuwahara alone
// reads as thick paint; the grade alone reads as a cheap posterise filter; all
// three are the look people mean when they say "painterly".
//
// Imports outside this file: the two filters and the Leva theme (cosmetic).
// Note the watercolour pulls a procedural paper texture out of
// `@/components/painterly`, so it is not quite the single-folder copy the
// Kuwahara is.
// ─────────────────────────────────────────────────────────────────────────────

/** Background AND the horizon: the ground casts a shadow and nothing else, so
 *  this colour is the whole backdrop. */
const BACKDROP = "#e8ddc8";

function Scene() {
  const { color, roughness, metalness, autoRotate } = useControls("Scene", {
    color: { value: "#c2453a", label: "Knot Colour" },
    // Both of these change how much the image FLOWS, which is the filter's
    // input — a rough matte surface gives it almost nothing to align to, a
    // polished one hands it long specular streaks to stroke along.
    roughness: { value: 0.56, min: 0, max: 1, step: 0.01 },
    metalness: { value: 0.1, min: 0, max: 1, step: 0.01 },
    autoRotate: { value: true, label: "Auto Rotate" },
  });

  return (
    <>
      <color attach="background" args={[BACKDROP]} />

      <ambientLight intensity={0.6} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
        // Tightened around the knot: the default ortho frustum is -5..5 in
        // every direction, and spreading 1024 texels over that much empty
        // floor is what turns a shadow edge into stair-steps.
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={1}
        shadow-camera-far={20}
      />
      {/* Second light, no shadows: the unlit side of the knot would otherwise
          go to a single flat colour, and a flat region gives the filter no
          gradient to work with — half the model would stop being painted. */}
      <directionalLight
        position={[-6, 2, -4]}
        intensity={0.8}
        color="#9fb8d8"
      />

      {/* At the origin, so OrbitControls' default target is the knot's own
          centre and it stays centred in frame however far the camera orbits. */}
      <mesh castShadow receiveShadow>
        <torusKnotGeometry args={[1, 0.35, 220, 32]} />
        <meshStandardMaterial
          color={color}
          roughness={roughness}
          metalness={metalness}
        />
      </mesh>

      {/* shadowMaterial, not a coloured plane: it draws ONLY where something
          shadows it and is transparent everywhere else, so the floor is
          literally the background and the shadow is the only mark on it. A
          plane painted the backdrop colour would not match — it is lit, and
          the backdrop is not.

          depthWrite={false} is what keeps it out of the OUTLINE. The plane is
          invisible in colour but, writing depth, it is very much visible to a
          depth-based edge detect: the 40×40 quad ends somewhere, and that jump
          from "floor" to "far plane" is a textbook depth discontinuity. You get
          an ink horizon ruled across an apparently empty background, drawn
          around geometry nobody can see.

          A shadow catcher has no business in the depth buffer. It still
          receives shadows (that is a shadow-map lookup in its own shader) and
          still depth-TESTS, so anything in front of it still occludes it. It
          simply stops existing as far as the depth buffer is concerned, which
          is the truth. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial transparent opacity={0.28} depthWrite={false} />
      </mesh>

      <OrbitControls
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
        enablePan={false}
        minDistance={3}
        maxDistance={14}
      />
    </>
  );
}

export default function PainterlyStarter() {
  // Owned here, not by either filter: the wipe spans the whole chain, and both
  // effects have to bypass the same strip or the "before" side is the raw
  // scene with the grade still sitting on it — which quietly turns the
  // comparison into "graded vs graded-and-painted".
  const { split } = useControls("Compare", {
    split: {
      value: 0,
      min: 0,
      max: 1,
      step: 0.001,
      label: "Before/After Wipe",
    },
  });

  // One panel, two mounted passes. Registered here rather than inside the
  // filter because both instances have to read the SAME values — two
  // `useControls` calls on one folder would fight over the store.
  const outline = useOutlineControls("Painterly Outline", {
    strength: 1,
    thickness: 3.8,
    threshold: 0.97,
    softness: 0.79,
    source: OUTLINE_SOURCE.DEPTH,
  });

  /**
   * How much of the ink is laid BEFORE the paint, where the brush gets to work
   * it over, versus after it, where nothing touches it again.
   *
   * The honest answer to "the Kuwahara eats my line". It is not a strength
   * multiplier on the paint — a downstream pass cannot ask an upstream one to
   * go easy — it is where the ink enters the chain, crossfaded. At 1 the line
   * is fully brushed and needs real thickness to survive; at 0 it is a crisp
   * overlay at any thickness; in between you get some of each.
   */
  const { brushInfluence } = useControls("Painterly Outline", {
    brushInfluence: {
      value: 0.93,
      min: 0,
      max: 1,
      step: 0.01,
      label: "Brush Influence",
    },
  });

  return (
    <>
      <Leva
        theme={LEVA_THEME}
        collapsed={false}
        titleBar={{ title: "CONTROLS" }}
      />
      <Canvas
        shadows={{ type: PCFSoftShadowMap }}
        // Slightly above the knot's centre so the shadow is in frame, but
        // AIMED at the origin — the knot sits dead centre at any orbit angle.
        camera={{ position: [0, 1.2, 6.5], fov: 45, near: 0.1, far: 100 }}
        gl={{ antialias: true }}
        // Pinned, not R3F's default [1, 2]. See the note at the top: the brush
        // is measured in pixels, so dpr changes both how strong the filter
        // looks and — at 200+ samples per pixel — how hard the GPU works.
        dpr={1}
        style={{ position: "fixed", inset: 0 }}
      >
        <Scene />

        {/* Three effects, nothing else — no bloom, no fog, no flare. Whatever
            is on screen is these three and not a stack of six arguing.

            All three stay mounted and each has its own off switch, rather than
            being conditionally rendered: unmounting one tears down its Leva
            folder, so every value dialled in would reset the moment it came
            back. Use "Paint (Kuwahara)", the outline's "Ink Amount" and the
            watercolour's "Amount" instead — and the faders are the nicer move
            on camera anyway, since a layer comes up gradually instead of
            popping. */}
        <EffectComposer>
          <OutlinePass
            values={outline}
            split={split}
            strengthScale={brushInfluence}
          />
          <KuwaharaFilter
            folder="Painterly (Kuwahara)"
            defaults={{ radius: 9, alpha: 4, eta: 0.36, lambda: 0.5 }}
            showDebug
            split={split}
          />
          <WatercolorFilter
            folder="Painterly Watercolor"
            split={split}
            defaults={{
              mix: 0.72,
              paperStrength: 0.47,
              paperScale: 3.55,
              quantLow: 0.21,
            }}
          />
        </EffectComposer>
      </Canvas>
    </>
  );
}
