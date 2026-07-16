"use client";

import { useEffect, useMemo } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { createGrassFieldUniforms } from "./uniforms";
import { GRASS_PRESETS } from "./presets";
import { MAX_ROCKS } from "./shaders/grassBlade";
import { makeGroundMaterial } from "./materials/groundMaterial";
import {
  makePineLeafMaterial,
  makePineLeafDepthMaterial,
} from "./materials/pineLeafMaterial";
import { makeBarkMaterial } from "./materials/barkMaterial";
import { scatterBlades, scatterFlowers } from "./utils/scatter";
import {
  useGrassControls,
  useFlowerControls,
  useGrassSceneControls,
} from "./utils/controls";

// ─────────────────────────────────────────────────────────────────────────────
// <GrassField />
//
// Turns a GLB into a stylized grass field. It loads the model, then rewires it
// by MATERIAL / MESH NAME — which is the whole integration contract:
//
//   groundMesh     the surface blades and flowers are scattered on, and which
//                  gets repainted with the grass color + procedural dirt
//   rockMaterial   meshes that press the grass down around them (trampling)
//   trunkMaterial  meshes repainted with the bark texture set
//   leafMaterial   meshes whose photographic RGB is replaced (alpha kept)
//
// Anything the field doesn't recognise is left as authored (with an optional PBR
// override to flatten it). To use your own model, either rename things to match
// the defaults below or pass your names as props — no code changes needed.
//
// Everything visual is a live uniform. Only the params marked "(rebuilds)" in
// Leva — the ones that change how many instances there are or how big they are —
// respawn geometry.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrassFieldProps {
  /** GLB to dress. Must contain a ground mesh named `groundMesh`. */
  url?: string;
  /** Name of the mesh to scatter grass and flowers onto. */
  groundMesh?: string;
  /** Material name of the meshes that trample the grass. */
  rockMaterial?: string;
  /** Material name of the tree trunks. */
  trunkMaterial?: string;
  /** Material name of the foliage (its texture's alpha is kept as the cut-out). */
  leafMaterial?: string;
  /** Bark maps, in this order: color, ambient occlusion, height. */
  barkTextures?: [string, string, string];
  /** Flower maps per variant, in this order: mask, RGB zones, base→tip gradient. */
  flowerTexturesA?: [string, string, string];
  flowerTexturesB?: [string, string, string];
  /** Key of a preset in GRASS_PRESETS. Pushes its values into the Leva panel,
   *  where they stay editable. */
  preset?: string;
  wireframe?: boolean;
  onLoaded?: () => void;
}

const DEFAULTS = {
  url: "/assets/grass-scene.glb",
  groundMesh: "grass-floor",
  rockMaterial: "RocksStylized_M",
  trunkMaterial: "Material.011",
  // Blender exported the pine-needle material with a hash for a name.
  leafMaterial: "2237f4d60830642a24d65276e7abe1e6",
  barkTextures: [
    "/assets/textures/bark/bark_color.png",
    "/assets/textures/bark/bark_AO.png",
    "/assets/textures/bark/bark_height.png",
  ] as [string, string, string],
  flowerTexturesA: [
    "/assets/textures/flower/flowers.png",
    "/assets/textures/flower/flowersRGB.png",
    "/assets/textures/flower/flowersGradient.png",
  ] as [string, string, string],
  flowerTexturesB: [
    "/assets/textures/flower3/flowers.png",
    "/assets/textures/flower3/flowersRGB.png",
    "/assets/textures/flower3/flowersGradient.png",
  ] as [string, string, string],
};

export default function GrassField({
  url = DEFAULTS.url,
  groundMesh = DEFAULTS.groundMesh,
  rockMaterial = DEFAULTS.rockMaterial,
  trunkMaterial = DEFAULTS.trunkMaterial,
  leafMaterial = DEFAULTS.leafMaterial,
  barkTextures = DEFAULTS.barkTextures,
  flowerTexturesA = DEFAULTS.flowerTexturesA,
  flowerTexturesB = DEFAULTS.flowerTexturesB,
  preset = "default",
  wireframe = false,
  onLoaded,
}: GrassFieldProps) {
  const { scene } = useGLTF(url);

  const [barkColor, barkAO, barkHeight] = useTexture(barkTextures);
  const [maskA, rgbA, gradA] = useTexture(flowerTexturesA);
  const [maskB, rgbB, gradB] = useTexture(flowerTexturesB);

  const [grass, setGrass] = useGrassControls();
  const flowers = useFlowerControls();
  const sceneCtl = useGrassSceneControls();

  // Presets are applied ON TOP OF the default, never on top of the previous
  // preset: a preset names only the values it changes, so without the reset the
  // fields it stays silent about would keep whatever the last one left there,
  // and switching A → B → A wouldn't land back on A.
  useEffect(() => {
    const p = GRASS_PRESETS[preset];
    if (!p) {
      console.warn(`[GrassField] unknown preset "${preset}".`);
      return;
    }
    setGrass({ ...GRASS_PRESETS.default.values, ...p.values });
  }, [preset, setGrass]);

  // One bag of uniforms for the whole field — see uniforms.ts.
  const u = useMemo(() => createGrassFieldUniforms(), []);

  // The directional light is mirrored into uSunDir/uSunColor for translucency:
  // our injected GLSL can't reach Lambert's own light uniforms. Resolved from
  // the scene on the first frame and cached here.
  const sun = useMemo(
    () => ({
      light: null as THREE.DirectionalLight | null,
      pos: new THREE.Vector3(),
      target: new THREE.Vector3(),
    }),
    [],
  );

  // Bark tiles via the uBarkScale uniform, so the maps must wrap. Only the color
  // map is sRGB — AO and height are data, not color.
  useEffect(() => {
    for (const t of [barkColor, barkAO, barkHeight]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
    }
    barkColor.colorSpace = THREE.SRGBColorSpace;
    barkAO.colorSpace = THREE.NoColorSpace;
    barkHeight.colorSpace = THREE.NoColorSpace;
  }, [barkColor, barkAO, barkHeight]);

  useEffect(() => {
    u.bark.uBarkColorMap.value = barkColor;
    u.bark.uBarkAOMap.value = barkAO;
    u.bark.uBarkHeightMap.value = barkHeight;

    u.flowerTexA.uFlowerMask.value = maskA;
    u.flowerTexA.uFlowerRGB.value = rgbA;
    u.flowerTexA.uFlowerGradient.value = gradA;
    u.flowerTexB.uFlowerMask.value = maskB;
    u.flowerTexB.uFlowerRGB.value = rgbB;
    u.flowerTexB.uFlowerGradient.value = gradB;
  }, [u, barkColor, barkAO, barkHeight, maskA, rgbA, gradA, maskB, rgbB, gradB]);

  // ── Build ──────────────────────────────────────────────────────────────────
  // Rebuilt only when instance geometry params change; everything else is a
  // uniform and never lands here.
  const { root, pbrMaterials } = useMemo(() => {
    const clone = scene.clone(true);
    // The clone isn't in the scene yet, so its world matrices aren't synced —
    // and the surface sampler needs them to place instances in world space.
    clone.updateMatrixWorld(true);

    const pbrMaterials: THREE.MeshStandardMaterial[] = [];
    const rocks: THREE.Vector4[] = [];
    let ground: THREE.Mesh | null = null;

    clone.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (mesh.name === groundMesh) {
        ground = mesh;
        return;
      }

      const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      // Rocks are handed to the blade shader as bounding spheres — all it needs
      // to press the grass down around them.
      if (src.some((m) => m.name === rockMaterial)) {
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        const bs = mesh.geometry.boundingSphere!;
        const center = bs.center.clone().applyMatrix4(mesh.matrixWorld);
        // The world matrix may scale non-uniformly; take the largest axis so the
        // influence disc never comes out smaller than the rock.
        const s = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
        const radius =
          bs.radius * Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        rocks.push(new THREE.Vector4(center.x, center.y, center.z, radius));
      }

      const swapped = src.map((m) => {
        if (m.name === leafMaterial) {
          const std = m as THREE.MeshStandardMaterial;
          // Static shadow (no wind) — a swaying canopy's moving shadow edge
          // flickers on the grass, and its sway is invisible in a soft high blob
          // anyway. Keeping it static also lets the shadow map be frozen entirely.
          mesh.customDepthMaterial = makePineLeafDepthMaterial(std);
          return makePineLeafMaterial(std, mesh, u.surface);
        }
        if (m.name === trunkMaterial) {
          return makeBarkMaterial(u.bark);
        }
        // Untouched GLB material — cloned so the PBR override below doesn't
        // mutate the material cached by useGLTF and shared with any other user
        // of this GLB.
        const c = (m as THREE.MeshStandardMaterial).clone();
        pbrMaterials.push(c);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? swapped : swapped[0];
    });

    // Publish the rocks into the shader's fixed-size uniform array.
    const slots = u.surface.uRocks.value;
    const n = Math.min(rocks.length, MAX_ROCKS);
    for (let i = 0; i < n; i++) slots[i].copy(rocks[i]);
    u.surface.uRockCount.value = n;
    if (rocks.length > MAX_ROCKS) {
      console.warn(
        `[GrassField] ${rocks.length} rocks found but the shader's uniform array holds ${MAX_ROCKS} — the rest won't flatten grass.`,
      );
    }

    if (!ground) {
      console.warn(
        `[GrassField] mesh "${groundMesh}" not found in ${url} — no grass spawned.`,
      );
      return { root: clone, pbrMaterials };
    }

    const groundMeshRef = ground as THREE.Mesh;
    const srcMat = (
      Array.isArray(groundMeshRef.material)
        ? groundMeshRef.material[0]
        : groundMeshRef.material
    ) as THREE.MeshStandardMaterial;
    groundMeshRef.material = makeGroundMaterial(u.surface, srcMat.color);

    clone.add(
      scatterBlades(groundMeshRef, {
        uniforms: u.surface,
        density: grass.grDensity,
        maxCount: grass.grMaxCount,
        minWidth: grass.grMinWidth,
        maxWidth: grass.grMaxWidth,
        minLength: grass.grMinLength,
        maxLength: grass.grMaxLength,
        tiltMax: grass.grTiltMax,
        segments: grass.grSegments,
      }),
    );

    if (flowers.flEnabled) {
      for (const im of scatterFlowers(groundMeshRef, {
        uniforms: u.flower,
        texA: u.flowerTexA,
        texB: u.flowerTexB,
        dirt: u.surface,
        density: flowers.flDensity,
        maxCount: flowers.flMaxCount,
        size: flowers.flSize,
        mixA: flowers.flMixA,
      })) {
        clone.add(im);
      }
    }

    return { root: clone, pbrMaterials };
  }, [
    scene,
    u,
    url,
    groundMesh,
    rockMaterial,
    trunkMaterial,
    leafMaterial,
    grass.grDensity,
    grass.grMaxCount,
    grass.grMinWidth,
    grass.grMaxWidth,
    grass.grMinLength,
    grass.grMaxLength,
    grass.grTiltMax,
    grass.grSegments,
    flowers.flEnabled,
    flowers.flDensity,
    flowers.flMaxCount,
    flowers.flSize,
    flowers.flMixA,
  ]);

  useEffect(() => {
    onLoaded?.();
  }, [root, onLoaded]);

  // PBR override — only the GLB materials the field didn't replace.
  useEffect(() => {
    for (const m of pbrMaterials) {
      if (sceneCtl.matOverride) {
        m.roughness = sceneCtl.roughness;
        m.metalness = sceneCtl.metalness;
        m.envMapIntensity = sceneCtl.envIntensity;
      }
      m.flatShading = sceneCtl.matOverride && sceneCtl.flatShading;
      m.needsUpdate = true;
    }
  }, [
    pbrMaterials,
    sceneCtl.matOverride,
    sceneCtl.roughness,
    sceneCtl.metalness,
    sceneCtl.envIntensity,
    sceneCtl.flatShading,
  ]);

  useEffect(() => {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.MeshStandardMaterial).wireframe = wireframe;
    });
  }, [root, wireframe]);

  // ── Uniform sync — every frame, no recompiles ──────────────────────────────
  useFrame((state, delta) => {
    const s = u.surface;
    const f = u.flower;
    const b = u.bark;

    s.uTime.value = (s.uTime.value + delta) % 3600;

    if (!sun.light) {
      state.scene.traverse((o) => {
        if (!sun.light && (o as THREE.DirectionalLight).isDirectionalLight) {
          sun.light = o as THREE.DirectionalLight;
        }
      });
    }
    if (sun.light) {
      sun.light.getWorldPosition(sun.pos);
      sun.light.target.getWorldPosition(sun.target);
      s.uSunDir.value.subVectors(sun.pos, sun.target).normalize();
      s.uSunColor.value.copy(sun.light.color).multiplyScalar(sun.light.intensity);
    }

    // Blades
    const rad = grass.grWindDir * (Math.PI / 180);
    s.uWindDir.value.set(Math.cos(rad), Math.sin(rad));
    s.uWindStrength.value = grass.grWindStrength;
    s.uWindSpeed.value = grass.grWindSpeed;
    s.uWindFreq.value = grass.grWindFreq;
    s.uWindTurb.value = grass.grWindTurb;
    s.uWindLean.value = grass.grWindLean;

    s.uGrassBottom.value.set(grass.grColorBottom);
    s.uGrassTop.value.set(grass.grColorTop);
    s.uGradStart.value = grass.grGradStart;
    s.uGradEnd.value = grass.grGradEnd;
    s.uGradPower.value = grass.grGradPower;
    s.uBrightness.value = grass.grBrightness;

    s.uShadowStrength.value = grass.grShadowStrength;
    s.uShadowSamples.value = grass.grShadowSamples;
    s.uShadowSampleY.value = grass.grShadowSampleY;
    s.uShadowRadius.value = grass.grShadowRadius;

    s.uTransColor.value.set(grass.grTransColor);
    s.uTransStrength.value = grass.grTransStrength;
    s.uTransPower.value = grass.grTransPower;
    s.uTransTip.value = grass.grTransTip;
    s.uTransShadow.value = grass.grTransShadow;

    s.uDebugChannel.value = grass.grDebugChannel;
    s.uWindFixLocal.value = grass.grWindFixLocal ? 1 : 0;

    s.uRockFlatten.value = grass.grRockFlatten;
    s.uRockBend.value = grass.grRockBend;
    s.uRockRadiusMul.value = grass.grRockRadiusMul;
    s.uRockFalloff.value = grass.grRockFalloff;

    // Ground
    s.uTintFloor.value = grass.grTintFloor ? 1 : 0;
    s.uFlatFloorNormal.value = grass.grFlatFloorNormal;
    s.uDirtColor.value.set(grass.grDirtColor);
    s.uDirtCoverage.value = grass.grDirtCoverage;
    s.uDirtScale.value = grass.grDirtScale;
    s.uDirtSoftness.value = grass.grDirtSoftness;
    s.uDirtWarp.value = grass.grDirtWarp;
    s.uDirtCut.value = grass.grDirtCut;
    s.uDirtBlend.value = grass.grDirtBlend;
    s.uGndVarColor.value.set(grass.grGndVarColor);
    s.uGndVarScale.value = grass.grGndVarScale;
    s.uGndVarStrength.value = grass.grGndVarStrength;
    s.uGndGrainScale.value = grass.grGndGrainScale;
    s.uGndGrainStrength.value = grass.grGndGrainStrength;
    s.uGndReliefScale.value = grass.grGndReliefScale;
    s.uGndReliefStrength.value = grass.grGndReliefStrength;

    // Pine needles
    s.uLeafBottom.value.set(grass.grLeafBottom);
    s.uLeafTop.value.set(grass.grLeafTop);
    s.uLeafGradPower.value = grass.grLeafGradPower;
    s.uLeafBrightness.value = grass.grLeafBrightness;
    s.uLeafVarColor.value.set(grass.grLeafVarColor);
    s.uLeafVarStrength.value = grass.grLeafVarStrength;
    s.uLeafVarScale.value = grass.grLeafVarScale;
    s.uLeafWindStrength.value = grass.grLeafWindStrength;
    s.uLeafFlutterAmp.value = grass.grLeafFlutterAmp;
    s.uLeafFlutterSpeed.value = grass.grLeafFlutterSpeed;
    s.uLeafDip.value = grass.grLeafDip;

    // Bark
    b.uBarkScale.value = grass.grBarkScale;
    b.uBarkTint.value.set(grass.grBarkTint);
    b.uBarkTintStrength.value = grass.grBarkTintStrength;
    b.uBarkSaturation.value = grass.grBarkSaturation;
    b.uBarkBrightness.value = grass.grBarkBrightness;
    b.uBarkAOStrength.value = grass.grBarkAOStrength;
    b.uBarkRelief.value = grass.grBarkRelief;

    // Flowers — they share the grass wind direction and ground color, so the
    // whole field sways together and every base melts into the same soil.
    f.uTime.value = s.uTime.value;
    f.uWindDir.value.copy(s.uWindDir.value);
    f.uGrassColor.value.copy(s.uGrassBottom.value);
    f.uColorR.value.set(flowers.flColorR);
    f.uColorG.value.set(flowers.flColorG);
    f.uColorB.value.set(flowers.flColorB);
    f.uColorStem.value.set(flowers.flColorStem);
    f.uBrightness.value = flowers.flBrightness;
    f.uWindStrength.value = flowers.flWindStrength;
    f.uWindSpeed.value = flowers.flWindSpeed;
    f.uWindFreq.value = flowers.flWindFreq;
    f.uWindTurb.value = flowers.flWindTurb;
    f.uWindLean.value = flowers.flWindLean;
    f.uBendAmp.value = flowers.flBendAmp;
    f.uBendFreq.value = flowers.flBendFreq;
    f.uFlDirtMax.value = flowers.flDirtMax;
  });

  return (
    <group
      position={[sceneCtl.posX, sceneCtl.posY, sceneCtl.posZ]}
      rotation={[
        THREE.MathUtils.degToRad(sceneCtl.rotX),
        THREE.MathUtils.degToRad(sceneCtl.rotY),
        THREE.MathUtils.degToRad(sceneCtl.rotZ),
      ]}
    >
      <primitive object={root} scale={sceneCtl.scale} />
    </group>
  );
}

useGLTF.preload(DEFAULTS.url);
