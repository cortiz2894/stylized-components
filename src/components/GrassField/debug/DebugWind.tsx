"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { useGrassControls } from "../utils/controls";

// ─────────────────────────────────────────────────────────────────────────────
// DebugWind — the gust, made visible. Built for the breakdown video.
//
// The blades don't each pick their own sway: they all read ONE scalar field —
//
//     wave(p, t) = sin( dot(p.xz, dir) · freq + t · speed )
//
// — and lean by it. This plane paints that exact expression as grayscale, so the
// thing the grass is responding to becomes something you can watch travel across
// the ground.
//
// It maps the three controls straight onto what you see:
//   DIRECTION  which way the bands travel (the arrow, and the dot product)
//   FREQUENCY  how tightly packed the bands are — the wavelength of a gust
//   SPEED      how fast they sweep across
//   STRENGTH   not visible here at all: it's the amplitude the blades multiply
//              this by. The field is the same; strength is how hard it's felt.
//
// Reads the same Leva controls the field reads, so the bands and the grass are
// always in lockstep.
// ─────────────────────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec2 vWorldXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vWorldXZ;

  uniform float uTime;
  uniform vec2  uWindDir;
  uniform float uWindFreq;
  uniform float uWindSpeed;
  uniform float uWindTurb;
  uniform int   uStage;
  uniform float uOpacity;

  void main() {
    // The blades' own wind expression, verbatim.
    float primary = sin(dot(vWorldXZ, uWindDir) * uWindFreq + uTime * uWindSpeed);

    float wave = primary;

    if (uStage >= 1) {
      // A second, faster harmonic — keeps the gust from reading as a perfect,
      // mechanical sine.
      float second = sin(dot(vWorldXZ, uWindDir) * uWindFreq * 2.6
                       + uTime * uWindSpeed * 1.8 + 1.3) * 0.35;
      wave += second;
    }

    if (uStage >= 2) {
      // Turbulence: a wave running PERPENDICULAR to the wind, so the bands break
      // up sideways instead of marching in perfectly straight lines.
      vec2  perp = vec2(-uWindDir.y, uWindDir.x);
      float turb = sin(dot(vWorldXZ, perp) * uWindFreq * 1.9
                     + uTime * uWindSpeed * 0.7 + 2.6) * uWindTurb;
      wave += turb;
    }

    // The wave is signed (-1 → +1): blades lean one way, then the other. Remap to
    // 0 → 1 so mid-gray is "at rest" and the extremes are the two lean directions.
    // Kept off pure black and pure white: black reads as "nothing here" on camera,
    // and white blows out through the scene's bloom.
    float g = clamp(wave * 0.5 + 0.5, 0.0, 1.0);
    g = mix(0.1, 0.92, g);

    gl_FragColor = vec4(vec3(g), uOpacity);
  }
`;

export default function DebugWind() {
  const timeRef = useRef(0);

  const [grass] = useGrassControls();

  const { stage, size, height, opacity, showArrow } = useControls("Debug Wind", {
    stage: {
      value: 2,
      options: {
        "1 · Primary sine": 0,
        "2 · + Second harmonic": 1,
        "3 · + Turbulence (full)": 2,
      },
      label: "Layers",
    },
    size: { value: 15, min: 2, max: 60, step: 0.5, label: "Plane Size" },
    // Hovering ABOVE the grass, not on the ground: the terrain is a domed island,
    // so a plane at ground level is buried under it and only its corners show.
    // Floating it over the field is what lets you watch a gust cross the grass
    // and the blades lean as it passes.
    height: { value: 1.6, min: -1, max: 8, step: 0.05, label: "Height (Y)" },
    opacity: { value: 0.7, min: 0.05, max: 1, step: 0.05, label: "Opacity" },
    showArrow: { value: true, label: "Direction Arrow" },
  });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        // An overlay: it must not occlude the grass it's explaining.
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uWindDir: { value: new THREE.Vector2(1, 0) },
          uWindFreq: { value: 0.5 },
          uWindSpeed: { value: 1.3 },
          uWindTurb: { value: 0.04 },
          uStage: { value: 2 },
          uOpacity: { value: 0.7 },
        },
      }),
    [],
  );

  const arrow = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 0),
        3,
        0x00e0ff,
        0.7,
        0.35,
      ),
    [],
  );

  useFrame((_, delta) => {
    timeRef.current = (timeRef.current + delta) % 3600;

    const rad = grass.grWindDir * (Math.PI / 180);
    const dir = new THREE.Vector2(Math.cos(rad), Math.sin(rad));

    const u = material.uniforms;
    u.uTime.value = timeRef.current;
    u.uWindDir.value.copy(dir);
    u.uWindFreq.value = grass.grWindFreq;
    u.uWindSpeed.value = grass.grWindSpeed;
    u.uWindTurb.value = grass.grWindTurb;
    u.uStage.value = stage;
    u.uOpacity.value = opacity;

    // The wind is a 2-D direction on the XZ plane: x → x, y → z.
    arrow.setDirection(new THREE.Vector3(dir.x, 0, dir.y).normalize());
  });

  return (
    <group>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, height, 0]}
        material={material}
        renderOrder={10}
      >
        <planeGeometry args={[size, size]} />
      </mesh>

      {showArrow && <primitive object={arrow} position={[0, height + 0.5, 0]} />}
    </group>
  );
}
