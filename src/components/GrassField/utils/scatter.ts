import * as THREE from "three";
import type {
  BladeUniforms,
  FlowerUniforms,
  FlowerTextures,
  DirtUniforms,
} from "../uniforms";
import { makeBladeGeometry, makeBladeMaterial } from "../materials/bladeMaterial";
import {
  makeFlowerMaterial,
  makeFlowerDepthMaterial,
} from "../materials/flowerMaterial";

// ─────────────────────────────────────────────────────────────────────────────
// Scattering — placing blades and flowers on a surface.
//
// Both use AREA-WEIGHTED sampling of the surface's triangles: pick a triangle
// with probability proportional to its area, then a uniform point inside it.
// The obvious alternative — scatter points over the bounding box and raycast
// down — wastes every sample that falls in a gap, so density had to be cranked
// up to compensate and still came out uneven. Sampling the faces means every
// instance lands ON the surface, and `density` means exactly what it says:
// instances per world unit² of surface.
//
// Placement is deterministic (seeded RNG), so the same surface always produces
// the same field — no reshuffling on every reload.
// ─────────────────────────────────────────────────────────────────────────────

/** Seeded LCG — the same seed always produces the same layout. */
export function seededLcg(seed: number) {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Triangles of a mesh in world space, with a cumulative-area table. */
interface SurfaceSampler {
  /** Flat [ax,ay,az, bx,by,bz, cx,cy,cz] per triangle. */
  verts: number[];
  /** cumArea[i] = total area up to and including triangle i. */
  cumArea: number[];
  totalArea: number;
}

/** `mesh.matrixWorld` must already be resolved by the caller. */
function buildSurfaceSampler(mesh: THREE.Mesh): SurfaceSampler {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const idx = mesh.geometry.index;
  const mw = mesh.matrixWorld;

  const verts: number[] = [];
  const cumArea: number[] = [];
  let totalArea = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();

  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let f = 0; f < triCount; f++) {
    const i0 = idx ? idx.getX(f * 3) : f * 3;
    const i1 = idx ? idx.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(mw);
    b.fromBufferAttribute(pos, i1).applyMatrix4(mw);
    c.fromBufferAttribute(pos, i2).applyMatrix4(mw);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const dbl = n.length(); // = 2 × triangle area
    if (dbl < 1e-8) continue;

    totalArea += dbl * 0.5;
    cumArea.push(totalArea);
    verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  return { verts, cumArea, totalArea };
}

/** Area-weighted random point on the sampled surface. */
function samplePoint(
  s: SurfaceSampler,
  rng: () => number,
  out: THREE.Vector3,
): THREE.Vector3 {
  // Pick a triangle proportional to its area (binary search on the cumulative).
  const r = rng() * s.totalArea;
  let lo = 0;
  let hi = s.cumArea.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cumArea[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  const t = lo * 9;

  // Uniform barycentric point inside that triangle.
  let u = rng();
  let v = rng();
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  const w = 1 - u - v;

  return out.set(
    s.verts[t] * w + s.verts[t + 3] * u + s.verts[t + 6] * v,
    s.verts[t + 1] * w + s.verts[t + 4] * u + s.verts[t + 7] * v,
    s.verts[t + 2] * w + s.verts[t + 5] * u + s.verts[t + 8] * v,
  );
}

// ── Grass blades ─────────────────────────────────────────────────────────────

export interface BladeScatterOptions {
  uniforms: BladeUniforms;
  /** Blades per world unit² of surface. */
  density: number;
  /** Hard cap, whatever the density works out to. */
  maxCount: number;
  minWidth: number;
  maxWidth: number;
  minLength: number;
  maxLength: number;
  /** Max random lean, in radians. */
  tiltMax: number;
}

export function scatterBlades(
  surface: THREE.Mesh,
  opts: BladeScatterOptions,
): THREE.InstancedMesh {
  const s = buildSurfaceSampler(surface);
  const count =
    s.cumArea.length === 0
      ? 1
      : Math.min(Math.max(1, Math.round(opts.density * s.totalArea)), opts.maxCount);

  const mat = makeBladeMaterial(opts.uniforms);
  mat.transparent = true;
  mat.depthWrite = true;

  const im = new THREE.InstancedMesh(makeBladeGeometry(), mat, count);
  // Blades don't cast: at this density the shadow map can't resolve them anyway,
  // and the field would shadow itself into mush. They only receive.
  im.castShadow = false;
  im.receiveShadow = true;
  // Instances are placed in world space, so the mesh's own bounds are useless.
  im.frustumCulled = false;

  const rng = seededLcg(Math.abs(Math.round(s.totalArea * 131)) || 1);
  const dummy = new THREE.Object3D();
  const p = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    if (s.cumArea.length === 0) {
      dummy.scale.setScalar(0);
    } else {
      samplePoint(s, rng, p);
      dummy.position.copy(p);
      dummy.rotation.set(
        (rng() - 0.5) * 2 * opts.tiltMax,
        rng() * Math.PI * 2,
        (rng() - 0.5) * opts.tiltMax * 0.5,
      );
      dummy.scale.set(
        opts.minWidth + rng() * (opts.maxWidth - opts.minWidth),
        opts.minLength + rng() * (opts.maxLength - opts.minLength),
        1,
      );
    }
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  }

  im.instanceMatrix.needsUpdate = true;
  return im;
}

// ── Flowers ──────────────────────────────────────────────────────────────────

export interface FlowerScatterOptions {
  uniforms: FlowerUniforms;
  texA: FlowerTextures;
  texB: FlowerTextures;
  /** Flowers are placed everywhere, then culled off the dirt in the shader — so
   *  the dirt Coverage slider stays live and never respawns instances. */
  dirt: DirtUniforms;
  /** Flowers per world unit² of surface. */
  density: number;
  /** Hard cap on total flowers (each becomes 2 quads — see below). */
  maxCount: number;
  size: number;
  /** Fraction of flowers using texA (0..1); the rest use texB. */
  mixA?: number;
}

/** Returns one InstancedMesh per texture variant. */
export function scatterFlowers(
  surface: THREE.Mesh,
  opts: FlowerScatterOptions,
): THREE.InstancedMesh[] {
  const s = buildSurfaceSampler(surface);
  const mixA = opts.mixA ?? 0.5;
  const total =
    s.cumArea.length === 0
      ? 0
      : Math.min(Math.round(opts.density * s.totalArea), opts.maxCount);

  // Decide the variant split up front, with its own RNG, so each variant's
  // InstancedMesh can be allocated at exactly the right size.
  const typeRng = seededLcg(Math.abs(Math.round(s.totalArea * 977)) || 13);
  const useA: boolean[] = [];
  let countA = 0;
  for (let i = 0; i < total; i++) {
    const isA = typeRng() < mixA;
    useA.push(isA);
    if (isA) countA++;
  }
  const countB = total - countA;

  // PlaneGeometry(1,1) shifted so the pivot sits at the flower's base:
  // uv.y = 0 → ground (the gradient map is black there, so it blends into the
  // grass), uv.y = 1 → tip.
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);

  // ×2: each flower is a cross-billboard — two quads 90° apart, so it reads as
  // volumetric from any angle.
  const imA = new THREE.InstancedMesh(
    geo,
    makeFlowerMaterial(opts.texA, opts.uniforms, opts.dirt),
    countA * 2,
  );
  const imB = new THREE.InstancedMesh(
    geo,
    makeFlowerMaterial(opts.texB, opts.uniforms, opts.dirt),
    countB * 2,
  );

  // Without these, each flower would cast the shadow of its quad. See
  // makeFlowerDepthMaterial.
  imA.customDepthMaterial = makeFlowerDepthMaterial(
    opts.texA,
    opts.uniforms,
    opts.dirt,
  );
  imB.customDepthMaterial = makeFlowerDepthMaterial(
    opts.texB,
    opts.uniforms,
    opts.dirt,
  );

  for (const im of [imA, imB]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
  }
  if (s.cumArea.length === 0) return [imA, imB];

  const rng = seededLcg(Math.abs(Math.round(s.totalArea * 131)) || 7);
  const dummy = new THREE.Object3D();
  const p = new THREE.Vector3();
  let iA = 0;
  let iB = 0;

  for (let i = 0; i < total; i++) {
    samplePoint(s, rng, p);
    const ry = rng() * Math.PI * 2;

    const target = useA[i] ? imA : imB;
    const slot = useA[i] ? iA++ : iB++;

    dummy.position.copy(p);
    dummy.scale.setScalar(opts.size);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    target.setMatrixAt(slot * 2, dummy.matrix);

    dummy.rotation.set(0, ry + Math.PI * 0.5, 0);
    dummy.updateMatrix();
    target.setMatrixAt(slot * 2 + 1, dummy.matrix);
  }

  imA.instanceMatrix.needsUpdate = true;
  imB.instanceMatrix.needsUpdate = true;
  return [imA, imB];
}
