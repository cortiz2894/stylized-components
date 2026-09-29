"use client";

/* eslint-disable react-hooks/immutability -- Writes to three.js objects: a
   material's uniforms. That IS the library's API; see the same note in
   ChakraMotes. */

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three";
import { WINDOW_LIGHT_GLSL, windowLightUniforms } from "./classroomWindows";

/**
 * Where the dust lives: the window half of the room, floor to just under the
 * ceiling. Motes deep on the corridor side would never cross a beam, so they
 * would only ever be the faint unlit speckle — spending them where the light
 * actually falls is what makes a few thousand read as a lot.
 */
const DUST_MIN = new THREE.Vector3(46, -0.8, -5.8);
const DUST_MAX = new THREE.Vector3(63.9, 8.6, 18.6);

/**
 * Per-mote buffers: a normalised start position and three seeds.
 *
 * Module scope, not inline in the memo, for the reason ChakraMotes gives:
 * `Math.random` during render is exactly what the purity rule is there to
 * catch, and dust does not need to be reproducible.
 */
function buildDustBuffers(count: number) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    positions[i] = Math.random();
    seeds[i] = Math.random();
  }
  return { positions, seeds };
}

const VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uDrift;
uniform float uWobble;
uniform float uSize;
uniform float uSizeVariance;
uniform float uViewportHeight;
/** 0 = normal · 1 = colour-coded by the test · 2 = test off, every mote lit */
uniform int uDebugView;

${WINDOW_LIGHT_GLSL}

attribute vec3 aSeed;

varying float vLit;
varying float vFade;
varying float vTwinkle;

void main() {
  // ── Drift ─────────────────────────────────────────────────────────────────
  // A slow straight wander per mote plus a small wobble on top. Dust in still
  // air is not rising or falling so much as hanging — the wobble is what sells
  // it as being pushed around by air nobody can feel.
  vec3 wander = (aSeed - 0.5) * vec3(1.0, 0.45, 1.0) * uDrift * uTime;
  wander.y += uDrift * 0.15 * uTime; // a faint warm-air lift
  float ph = aSeed.x * 6.2831;
  vec3 wobble = vec3(
    sin(uTime * 0.37 + ph * 3.0),
    sin(uTime * 0.29 + ph * 5.0),
    cos(uTime * 0.33 + ph * 7.0)
  ) * uWobble;

  // Wrapped inside the box so the count never thins out over time.
  vec3 local = mod(position * uBoxSize + wander + wobble, uBoxSize);
  vec3 world = uBoxMin + local;

  // Fade out over the last half unit before a wrap, so nothing pops.
  vec3 edge = min(local, uBoxSize - local);
  vFade = smoothstep(0.0, 0.5, min(min(edge.x, edge.y), edge.z));

  // ── The whole trick ───────────────────────────────────────────────────────
  // Is there glass between this mote and the sun? Same test the shafts use,
  // so a mote lights up exactly when it drifts into a beam.
  vLit = uDebugView == 2 ? 1.0 : windowLight(world).x;

  // Motes glint as they turn — a flat face catches the sun, then does not.
  vTwinkle = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed.z * 2.5) + aSeed.y * 40.0);

  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  // A world-space size projected to pixels, so a mote near the lens is big and
  // soft and one across the room is a pinpoint.
  float size = uSize * mix(1.0 - uSizeVariance, 1.0 + uSizeVariance, aSeed.z);
  gl_PointSize = max(
    size * projectionMatrix[1][1] * 0.5 * uViewportHeight / max(-mv.z, 0.05),
    1.0
  );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uLitColor;
uniform float uLitIntensity;
uniform vec3 uDimColor;
uniform float uDimIntensity;
uniform int uDebugView;

varying float vLit;
varying float vFade;
varying float vTwinkle;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = pow(clamp(1.0 - d, 0.0, 1.0), 1.6);
  if (disc <= 0.0) discard;

  // Out of the sun a mote is barely there; in it, it is the brightest thing in
  // the room. That contrast IS the effect — raise the dim side and the beams
  // stop reading, because the dust is everywhere instead of in the light.
  vec3 col = mix(uDimColor * uDimIntensity,
                 uLitColor * uLitIntensity * vTwinkle,
                 vLit);

  // Debug: every mote at full strength, coloured by the answer it got —
  // orange if the window test says it sees the sun, blue if it does not.
  if (uDebugView == 1) {
    col = mix(vec3(0.15, 0.45, 1.0), vec3(1.0, 0.55, 0.15) * 2.0, step(0.5, vLit));
  }
  gl_FragColor = vec4(col * disc * vFade, 1.0);
}
`;

interface DustMotesProps {
  /** TOWARD the sun, shared with the light and the shafts. */
  sunDir: THREE.Vector3;
  folder?: string;
  /** Scene-level off switch on top of the panel's own (the breakdown's). */
  active?: boolean;
  /** 0 = normal · 1 = colour-coded by the window test · 2 = test off. */
  debugView?: 0 | 1 | 2;
}

/**
 * Floating dust that only shows where the sun gets through.
 *
 * One draw call, no per-frame CPU work: each mote's position is a pure function
 * of `uTime`, and whether it is lit is answered in the vertex shader against the
 * window panes. Additive, so it bloom-glows along with the shafts.
 */
export default function DustMotes({
  sunDir,
  folder: folderName = "God Rays Dust",
  active = true,
  debugView = 0,
}: DustMotesProps) {
  const {
    enabled,
    count,
    size,
    sizeVariance,
    drift,
    wobble,
    litColor,
    litIntensity,
    dimColor,
    dimIntensity,
    edgeSoftness,
  } = useControls(folderName, {
    enabled: { value: true, label: "Dust" },
    count: { value: 4100, min: 0, max: 20000, step: 100, label: "Count" },
    Look: folder({
      size: { value: 0.05, min: 0.005, max: 0.2, step: 0.001, label: "Size" },
      sizeVariance: {
        value: 0.6,
        min: 0,
        max: 0.95,
        step: 0.01,
        label: "Size Variance",
      },
      litColor: { value: "#ffd9a3", label: "Lit Color" },
      litIntensity: {
        value: 0.84,
        min: 0,
        max: 10,
        step: 0.05,
        label: "Lit Intensity",
      },
      dimColor: { value: "#b0a0de", label: "Shade Color" },
      dimIntensity: {
        value: 0.04,
        min: 0,
        max: 1,
        step: 0.005,
        label: "Shade Intensity",
      },
      edgeSoftness: {
        value: 0.08,
        min: 0,
        max: 1,
        step: 0.005,
        label: "Beam Edge",
      },
    }),
    Motion: folder({
      drift: { value: 0.08, min: 0, max: 1, step: 0.005, label: "Drift" },
      wobble: { value: 0.12, min: 0, max: 1, step: 0.005, label: "Wobble" },
    }),
  });

  const geometry = useMemo(() => {
    const { positions, seeds } = buildDustBuffers(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    // The shader moves every mote anywhere inside the box; the default bounds
    // (the 0..1 cube the buffer holds) would cull the field whenever that cube
    // left the frustum.
    geo.boundingSphere = new THREE.Sphere(
      DUST_MIN.clone().add(DUST_MAX).multiplyScalar(0.5),
      DUST_MIN.distanceTo(DUST_MAX) * 0.5,
    );
    return geo;
  }, [count]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      name: "ClassroomDust",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        ...windowLightUniforms(sunDir),
        uTime: { value: 0 },
        uBoxMin: { value: DUST_MIN.clone() },
        uBoxSize: { value: DUST_MAX.clone().sub(DUST_MIN) },
        uDrift: { value: 0.08 },
        uWobble: { value: 0.12 },
        uSize: { value: 0.035 },
        uSizeVariance: { value: 0.6 },
        uViewportHeight: { value: 1 },
        uLitColor: { value: new THREE.Color() },
        uLitIntensity: { value: 2.2 },
        uDimColor: { value: new THREE.Color() },
        uDimIntensity: { value: 0.06 },
        uDebugView: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [sunDir]);

  useEffect(() => {
    const u = material.uniforms;
    u.uSize.value = size;
    u.uSizeVariance.value = sizeVariance;
    u.uDrift.value = drift;
    u.uWobble.value = wobble;
    (u.uLitColor.value as THREE.Color).set(litColor);
    u.uLitIntensity.value = litIntensity;
    (u.uDimColor.value as THREE.Color).set(dimColor);
    u.uDimIntensity.value = dimIntensity;
    u.uEdgeSoftness.value = edgeSoftness;
    u.uDebugView.value = debugView;
  }, [
    material,
    debugView,
    size,
    sizeVariance,
    drift,
    wobble,
    litColor,
    litIntensity,
    dimColor,
    dimIntensity,
    edgeSoftness,
  ]);

  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    // Drawing-buffer pixels, not CSS pixels: gl_PointSize is in the former, and
    // the adaptive resolution moves the dpr under us.
    u.uViewportHeight.value = state.size.height * state.viewport.dpr;
  });

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (!enabled || !active) return null;
  return <points geometry={geometry} material={material} frustumCulled />;
}
