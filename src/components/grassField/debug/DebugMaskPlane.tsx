"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { GROUND_MASK_UNIFORMS, GROUND_MASK_GLSL } from "../shaders/groundMask";
import { useGrassControls } from "../utils/controls";

// ─────────────────────────────────────────────────────────────────────────────
// DebugMaskPlane — the dirt colormap, laid out flat as grayscale.
//
// It imports the *same* GROUND_MASK_GLSL the ground, the blades and the flowers
// compile in, so this isn't a diagram of the noise — it IS the noise. Drag the
// Coverage slider here and the field's grass, dirt and flowers move with it.
//
// Three stages are exposed, which is the story the video tells:
//   Raw FBM     just noise. Gray mush.
//   Warped      the sample point is displaced by MORE noise (domain warping),
//               which is what turns round blobs into ragged, organic outlines.
//   Final mask  thresholded by Coverage → the patches the field actually uses.
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
  uniform int uStage;

  ${GROUND_MASK_UNIFORMS}
  ${GROUND_MASK_GLSL}

  void main() {
    vec2 p = vWorldXZ * uDirtScale;
    float v;

    if (uStage == 0) {
      // Raw FBM — no warp, no threshold.
      v = _gmFbm(p);
    } else if (uStage == 1) {
      // Domain-warped FBM: the sample point itself is pushed around by noise.
      vec2 w = vec2(_gmFbm(p + vec2(11.3, 2.7)), _gmFbm(p + vec2(5.9, 17.1)));
      v = _gmFbm(p + (w - 0.5) * uDirtWarp);
    } else {
      // The mask the field actually reads: 0 = grass, 1 = bare dirt.
      v = groundDirt(vWorldXZ);
    }

    gl_FragColor = vec4(vec3(v), 1.0);
  }
`;

export default function DebugMaskPlane() {
  // Reads the SAME Leva controls the field reads, rather than having the field
  // plumb its uniforms down here. Drag Coverage and the plane, the grass, the
  // dirt and the flowers all move together — which is the point being made.
  const [grass] = useGrassControls();

  const { stage, size, height } = useControls("Debug Mask", {
    stage: {
      value: 2,
      options: {
        "1 · Raw FBM": 0,
        "2 · Domain warped": 1,
        "3 · Final mask (thresholded)": 2,
      },
      label: "Stage",
    },
    size: { value: 16, min: 2, max: 60, step: 1, label: "Plane Size" },
    height: { value: 0.02, min: -1, max: 6, step: 0.02, label: "Height (Y)" },
  });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          uStage: { value: 2 },
          uDirtColor: { value: new THREE.Color() },
          uDirtScale: { value: 0.4 },
          uDirtCoverage: { value: 0.4 },
          uDirtSoftness: { value: 0.06 },
          uDirtWarp: { value: 0.2 },
        },
      }),
    [],
  );

  // Synced per frame (not during render) so the plane always shows exactly what
  // the field's shaders are currently reading.
  useFrame(() => {
    const u = material.uniforms;
    u.uStage.value = stage;
    u.uDirtScale.value = grass.grDirtScale;
    u.uDirtCoverage.value = grass.grDirtCoverage;
    u.uDirtSoftness.value = grass.grDirtSoftness;
    u.uDirtWarp.value = grass.grDirtWarp;
  });

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[0, height, 0]}
      material={material}
      renderOrder={10}
    >
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
