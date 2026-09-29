"use client";

/* eslint-disable react-hooks/immutability -- Writes to three.js buffers and
   instance matrices every frame. That IS the library's API. */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  FLOOR_Y,
  WINDOW_PANES,
  WINDOW_PLANE_X,
  windowLightAt,
} from "./classroomWindows";

// ─────────────────────────────────────────────────────────────────────────────
// Visuals for the breakdown — nothing here is part of the look.
//
//   · Panes     the glass rectangles the whole scene's light test is built on.
//   · Beams     each pane pushed away from the sun until it hits the floor:
//               the volume of lit air. Its footprint IS the floor patch.
//   · Ray       one camera ray, frozen in place, with its march samples —
//               orange if that point can see the sun through glass, blue if
//               not — and each sample's own line toward the sun.
//
// Drawn with `depthTest` off in X-Ray mode, so they read through the desks.
// ─────────────────────────────────────────────────────────────────────────────

const PANE_COLOR = new THREE.Color("#ffe29a");
const BEAM_COLOR = new THREE.Color("#ff9a4a");
const LIT_COLOR = new THREE.Color("#ffa040");
const UNLIT_COLOR = new THREE.Color("#3f7cff");

/** Nudged just inside the glass, so the outlines do not z-fight the frames. */
const PANE_X = WINDOW_PLANE_X - 0.05;

/** A pane's four corners at the glass, in drawing order. */
function paneCorners(r: THREE.Vector4): THREE.Vector3[] {
  return [
    new THREE.Vector3(PANE_X, r.z, r.x),
    new THREE.Vector3(PANE_X, r.z, r.y),
    new THREE.Vector3(PANE_X, r.w, r.y),
    new THREE.Vector3(PANE_X, r.w, r.x),
  ];
}

const PANE_CORNERS = WINDOW_PANES.map(paneCorners);

function lineMaterial(color: THREE.Color, opacity: number) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
}

// ── Panes ────────────────────────────────────────────────────────────────────

function PaneOutlines({ xray }: { xray: boolean }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    for (const c of PANE_CORNERS) {
      for (let i = 0; i < 4; i++) {
        const a = c[i];
        const b = c[(i + 1) % 4];
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, []);
  const material = useMemo(() => lineMaterial(PANE_COLOR, 1), []);

  useEffect(() => {
    material.depthTest = !xray;
  }, [material, xray]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <lineSegments geometry={geometry} material={material} renderOrder={10} />
  );
}

// ── Beams ────────────────────────────────────────────────────────────────────

/** 12 edges per pane (near rect, far rect, four connectors), 2 verts each. */
const BEAM_VERTS = WINDOW_PANES.length * 12 * 2;

function BeamVolumes({
  sunDir,
  xray,
}: {
  sunDir: THREE.Vector3;
  xray: boolean;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(BEAM_VERTS * 3), 3),
    );
    return geo;
  }, []);
  const material = useMemo(() => lineMaterial(BEAM_COLOR, 0.55), []);
  const far = useMemo(() => [0, 1, 2, 3].map(() => new THREE.Vector3()), []);

  useEffect(() => {
    material.depthTest = !xray;
  }, [material, xray]);

  // Per frame, because the sun moves with the Sky panel and these have to
  // follow it — it is 432 vertices, which is nothing.
  useFrame(() => {
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let o = 0;
    const push = (v: THREE.Vector3) => {
      arr[o++] = v.x;
      arr[o++] = v.y;
      arr[o++] = v.z;
    };

    for (const c of PANE_CORNERS) {
      // Each corner travels AWAY from the sun until it reaches the floor. A
      // flat sun would never get there; cap it at the far side of the room.
      for (let i = 0; i < 4; i++) {
        const t =
          sunDir.y > 1e-3 ? (c[i].y - FLOOR_Y) / sunDir.y : 40;
        far[i].copy(sunDir).multiplyScalar(-Math.min(t, 40)).add(c[i]);
      }
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        push(c[i]);
        push(c[j]);
        push(far[i]);
        push(far[j]);
        push(c[i]);
        push(far[i]);
      }
    }
    attr.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <lineSegments geometry={geometry} material={material} renderOrder={10} />
  );
}

// ── The frozen ray ───────────────────────────────────────────────────────────

const MAX_SAMPLES = 64;

function FrozenRay({
  sunDir,
  captureId,
  samples,
  showSunLines,
  xray,
}: {
  sunDir: THREE.Vector3;
  captureId: number;
  samples: number;
  showSunLines: boolean;
  xray: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  /** Where the ray was frozen: origin and the point it stopped at. */
  const ray = useRef<{ from: THREE.Vector3; to: THREE.Vector3 } | null>(null);

  const rayGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    return geo;
  }, []);
  const sunGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_SAMPLES * 6), 3),
    );
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(MAX_SAMPLES * 6), 3),
    );
    return geo;
  }, []);
  const rayMat = useMemo(() => lineMaterial(new THREE.Color("#ffffff"), 0.9), []);
  const sunMat = useMemo(() => {
    const m = lineMaterial(new THREE.Color("#ffffff"), 0.7);
    m.vertexColors = true;
    return m;
  }, []);
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.07, 12, 8), []);
  const sphereMat = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false }),
    [],
  );
  const instRef = useRef<THREE.InstancedMesh>(null);

  // ── Capture ────────────────────────────────────────────────────────────────
  // The centre-of-screen ray, cast into the room. It stops at the first real
  // surface — the same place the shaft march stops, since that one stops at the
  // depth buffer.
  useEffect(() => {
    if (captureId === 0) return;
    const from = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const caster = new THREE.Raycaster(from, dir, 0.05, 80);
    const hits = caster
      .intersectObjects(scene.children, true)
      .filter(
        (h) =>
          (h.object as THREE.Mesh).isMesh &&
          !(h.object as THREE.InstancedMesh).isInstancedMesh &&
          h.object.visible,
      );
    const dist = hits.length > 0 ? hits[0].distance : 30;
    ray.current = { from, to: dir.multiplyScalar(dist).add(from) };
  }, [captureId, camera, scene]);

  const tmpP = useMemo(() => new THREE.Vector3(), []);
  const tmpHit = useMemo(() => new THREE.Vector3(), []);
  const tmpM = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const inst = instRef.current;
    const r = ray.current;
    if (!inst) return;
    if (!r) {
      inst.count = 0;
      return;
    }

    const rp = rayGeo.getAttribute("position") as THREE.BufferAttribute;
    rp.setXYZ(0, r.from.x, r.from.y, r.from.z);
    rp.setXYZ(1, r.to.x, r.to.y, r.to.z);
    rp.needsUpdate = true;
    rayGeo.computeBoundingSphere();

    const sp = sunGeo.getAttribute("position") as THREE.BufferAttribute;
    const sc = sunGeo.getAttribute("color") as THREE.BufferAttribute;
    const n = Math.min(samples, MAX_SAMPLES);
    let lines = 0;

    for (let i = 0; i < n; i++) {
      // Centred in each step — the un-jittered march, so what is drawn is
      // exactly what "Jitter: off" renders.
      tmpP.lerpVectors(r.from, r.to, (i + 0.5) / n);
      const { crosses, lit } = windowLightAt(tmpP, sunDir, tmpHit);
      const col = lit ? LIT_COLOR : UNLIT_COLOR;

      tmpM.makeTranslation(tmpP.x, tmpP.y, tmpP.z);
      inst.setMatrixAt(i, tmpM);
      inst.setColorAt(i, col);

      if (crosses) {
        sp.setXYZ(lines * 2, tmpP.x, tmpP.y, tmpP.z);
        sp.setXYZ(lines * 2 + 1, tmpHit.x, tmpHit.y, tmpHit.z);
        sc.setXYZ(lines * 2, col.r, col.g, col.b);
        sc.setXYZ(lines * 2 + 1, col.r, col.g, col.b);
        lines++;
      }
    }

    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();

    sunGeo.setDrawRange(0, showSunLines ? lines * 2 : 0);
    sp.needsUpdate = true;
    sc.needsUpdate = true;
    sunGeo.computeBoundingSphere();
  });

  useEffect(() => {
    for (const m of [rayMat, sunMat, sphereMat]) m.depthTest = !xray;
  }, [rayMat, sunMat, sphereMat, xray]);

  useEffect(
    () => () => {
      for (const d of [rayGeo, sunGeo, sphereGeo, rayMat, sunMat, sphereMat])
        d.dispose();
    },
    [rayGeo, sunGeo, sphereGeo, rayMat, sunMat, sphereMat],
  );

  return (
    <>
      <lineSegments geometry={rayGeo} material={rayMat} renderOrder={11} />
      <lineSegments geometry={sunGeo} material={sunMat} renderOrder={11} />
      <instancedMesh
        ref={instRef}
        args={[sphereGeo, sphereMat, MAX_SAMPLES]}
        renderOrder={12}
        frustumCulled={false}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export interface BreakdownHelpersProps {
  sunDir: THREE.Vector3;
  panes: boolean;
  beams: boolean;
  ray: boolean;
  sunLines: boolean;
  raySamples: number;
  captureId: number;
  xray: boolean;
}

export default function BreakdownHelpers({
  sunDir,
  panes,
  beams,
  ray,
  sunLines,
  raySamples,
  captureId,
  xray,
}: BreakdownHelpersProps) {
  return (
    <>
      {panes && <PaneOutlines xray={xray} />}
      {beams && <BeamVolumes sunDir={sunDir} xray={xray} />}
      {/* Mounted whenever a ray has been captured, so hiding it does not throw
          the capture away. */}
      <group visible={ray}>
        <FrozenRay
          sunDir={sunDir}
          captureId={captureId}
          samples={raySamples}
          showSunLines={sunLines}
          xray={xray}
        />
      </group>
    </>
  );
}
