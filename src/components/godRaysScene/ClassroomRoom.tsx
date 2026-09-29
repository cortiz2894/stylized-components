"use client";

import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useControls } from "leva";
import * as THREE from "three";

const GLB_URL = "/assets/classRoomAnime/ClassRoom.glb";

useGLTF.preload(GLB_URL);

/**
 * Two flat tones: shade and light, nothing in between.
 *
 * The whole point of the room is that the sun cuts HARD shapes into it — a
 * slab on the floor, a stripe on the wall. A smooth Lambert falloff turns those
 * into soft gradients across every curved chair back, which is the look of a
 * render, not of a cel. The dark step is not black: the ambient still has to
 * land on it or the room vanishes.
 */
function makeToonRamp(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array([90, 255]),
    2,
    1,
    THREE.RedFormat,
  );
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * three's own light loop, with ONE condition added to the directional shadow
 * lookup: only faces that actually turn toward the sun are tested.
 *
 * ── Why this and not more bias ───────────────────────────────────────────────
 * A toon ramp's dark step is not zero — it is the "Shade Step" tone, and three
 * hands it to every face turned AWAY from the light too, then multiplies the
 * shadow into it like any other lit surface. The ceiling is the worst case: it
 * faces straight down, so the only thing between it and the sun is ITSELF, and
 * the lookup compares the surface's depth against its own depth in the map.
 * Half the texels win and half lose — that is the moiré.
 *
 * Such a face is in shadow by definition, so there is nothing for the map to
 * tell it. Skipping the lookup there makes the shade step a flat tone, which is
 * what it is on a cel anyway — and it fixes the acne without raising Normal
 * Bias, which would have detached the thin mullion shadows on the floor.
 */
const TOON_LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  "( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap",
  "( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.0 ) ? getShadow( directionalShadowMap",
);

if (TOON_LIGHTS_BEGIN === THREE.ShaderChunk.lights_fragment_begin) {
  // A three upgrade reworded the chunk. Nothing breaks — the acne comes back.
  console.warn(
    "[ClassroomRoom] directional shadow line not found; back-face acne fix inactive.",
  );
}

/**
 * The debug views, as the shader sees them. See useBreakdownControls.
 *   0 final · 1 albedo · 2 clay (white albedo, full lighting) · 3 sun only
 */
export type RoomDebugView = 0 | 1 | 2 | 3;

interface ClassroomRoomProps {
  folder?: string;
  debugView?: RoomDebugView;
  visible?: boolean;
}

/**
 * The classroom, re-lit.
 *
 * The GLB ships half of its materials UNLIT (KHR_materials_unlit) with the
 * lighting baked into their textures — the blackboard, the posters, the desk
 * tops. That is fine for a model viewer and useless here: an unlit surface
 * cannot receive a shadow, so the sun patches would stop dead at the edge of
 * every desk. Every material is swapped for a toon one that keeps the original
 * colour and texture, casts, and receives.
 */
export default function ClassroomRoom({
  folder = "God Rays Classroom",
  debugView = 0,
  visible = true,
}: ClassroomRoomProps) {
  const { scene } = useGLTF(GLB_URL);

  const { brightness, shadeTone } = useControls(folder, {
    brightness: {
      value: 1,
      min: 0.2,
      max: 3,
      step: 0.01,
      label: "Albedo",
    },
    shadeTone: {
      value: 27,
      min: 0,
      max: 255,
      step: 1,
      label: "Shade Step",
    },
  });

  const ramp = useMemo(() => makeToonRamp(), []);

  /** One uniform object shared by every material, so switching the view is a
   *  single write — no recompile, no traversal. */
  const debugUniform = useMemo(() => ({ value: 0 }), []);

  // useGLTF hands back the ONE cached graph for this URL, so the swap happens
  // on a clone — the cache keeps the original materials, and a remount does not
  // find toon materials where it expects the GLB's.
  const { root, materials } = useMemo(() => {
    const root = scene.clone(true);
    const materials: { mat: THREE.MeshToonMaterial; base: THREE.Color }[] = [];

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const src = mesh.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshToonMaterial({
        name: `${src.name}-toon`,
        color: src.color.clone(),
        map: src.map ?? null,
        gradientMap: ramp,
        side: THREE.DoubleSide,
      });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uDebugView = debugUniform;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform int uDebugView;",
          )
          .replace(
            "#include <color_fragment>",
            "#include <color_fragment>\nvec3 debugAlbedo = diffuseColor.rgb;\nif ( uDebugView >= 2 ) diffuseColor.rgb = vec3( 1.0 );",
          )
          .replace("#include <lights_fragment_begin>", TOON_LIGHTS_BEGIN)
          .replace(
            "#include <opaque_fragment>",
            [
              "if ( uDebugView == 1 ) outgoingLight = debugAlbedo;",
              "if ( uDebugView == 3 ) outgoingLight = reflectedLight.directDiffuse;",
              "#include <opaque_fragment>",
            ].join("\n"),
          );
      };
      materials.push({ mat, base: src.color.clone() });
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    return { root, materials };
  }, [scene, ramp, debugUniform]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    debugUniform.value = debugView;
  }, [debugUniform, debugView]);

  useEffect(() => {
    for (const { mat, base } of materials) {
      mat.color.copy(base).multiplyScalar(brightness);
    }
  }, [materials, brightness]);

  useEffect(() => {
    // Writing into the memoised ramp: that IS three's API for a DataTexture.
    /* eslint-disable react-hooks/immutability */
    (ramp.image.data as Uint8Array)[0] = shadeTone;
    ramp.needsUpdate = true;
    /* eslint-enable react-hooks/immutability */
  }, [ramp, shadeTone]);

  useEffect(
    () => () => {
      for (const { mat } of materials) mat.dispose();
    },
    [materials],
  );
  useEffect(() => () => ramp.dispose(), [ramp]);

  return <primitive object={root} visible={visible} />;
}
