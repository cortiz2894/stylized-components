"use client";

import { useMemo } from "react";
import { useGLTF, Html } from "@react-three/drei";
import { useControls, folder } from "leva";
import * as THREE from "three";
import { seededLcg, buildSurfaceSampler, samplePoint } from "../utils/scatter";

// ─────────────────────────────────────────────────────────────────────────────
// DebugScatter — where each blade stands. Built for the breakdown video.
//
// Every green point is one future blade, placed exactly the way the field places
// them: it calls the same buildSurfaceSampler / samplePoint / seededLcg the real
// scatter uses, so this isn't a re-creation of the algorithm — it IS the
// algorithm, with a dot drawn instead of a blade.
//
// The placement is area-weighted: pick a triangle with probability proportional
// to its area (the heat-map makes that visible — brighter = bigger = picked more
// often), then pick a uniform point inside it with barycentric coordinates.
//
// Which is what makes DENSITY a real quantity rather than a magic number:
//
//     blades = density × surface area
//
// The panel shows both sides of that multiplication. Change the density and the
// count follows from the surface itself — the same value gives the same coverage
// on a bigger or smaller mesh, because it's per unit² of ground, not per mesh.
// ─────────────────────────────────────────────────────────────────────────────

export interface DebugScatterProps {
  url?: string;
  groundMesh?: string;
}

const POINT = new THREE.Color("#7dff5a");

export default function DebugScatter({
  url = "/assets/grass-scene.glb",
  groundMesh = "grass-floor",
}: DebugScatterProps) {
  const { scene } = useGLTF(url);

  const {
    density,
    reveal,
    pointSize,
    showTriangles,
    heatGamma,
    showBBox,
    showStats,
  } = useControls(
      "Debug Scatter",
      {
        // The same units the field's own Density uses: blades per world unit².
        density: {
          value: 12,
          min: 0.5,
          max: 200,
          step: 0.5,
          label: "Density (pts/u²)",
        },
        // Grows the field in front of the camera — the shot for "how they spread".
        reveal: { value: 1, min: 0, max: 1, step: 0.01, label: "Reveal" },
        pointSize: {
          value: 0.06,
          min: 0.01,
          max: 0.4,
          step: 0.01,
          label: "Point Size",
        },
        Overlays: folder({
          showTriangles: { value: true, label: "Triangle Area Heatmap" },
          // < 1 exaggerates the differences between triangle sizes. On an even
          // grid like this ground the spread is only a few percent, so the raw
          // ramp is almost flat — this is what makes it readable on camera.
          heatGamma: {
            value: 0.5,
            min: 0.15,
            max: 3,
            step: 0.05,
            label: "Heatmap Contrast",
          },
          showBBox: { value: false, label: "Bounding Box" },
          showStats: { value: true, label: "Stats" },
        }),
      },
      { collapsed: false },
    );

  const ground = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);
    let found: THREE.Mesh | null = null;
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name === groundMesh) found = o as THREE.Mesh;
    });
    return found as THREE.Mesh | null;
  }, [scene, groundMesh]);

  const { points, stats } = useMemo(() => {
    if (!ground) return { points: null, stats: null };

    const sampler = buildSurfaceSampler(ground);
    // Exactly the field's rule: how many blades is not a number you pick, it's a
    // number that falls out of the surface.
    const count = Math.max(1, Math.round(density * sampler.totalArea));

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const p = new THREE.Vector3();
    const rng = seededLcg(1);

    for (let i = 0; i < count; i++) {
      samplePoint(sampler, rng, p);
      p.toArray(positions, i * 3);
      POINT.toArray(colors, i * 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    return {
      points: geo,
      stats: {
        count,
        density,
        triangles: sampler.cumArea.length,
        area: sampler.totalArea,
      },
    };
  }, [ground, density]);

  // Reveal is a draw-range, not a re-sample: the points don't move as it grows,
  // they just show up. Same seed, same field, every time.
  if (points && stats) {
    points.setDrawRange(0, Math.max(1, Math.round(stats.count * reveal)));
  }

  // ── Triangle heat-map: brightness ∝ area ∝ probability of being picked ─────
  //
  // Normalized between the SMALLEST and largest triangle, not between zero and
  // the largest. On a mesh with an even grid — like this ground — every area is
  // within a few percent of the max, so a 0→max ramp paints the whole surface
  // white and the heat-map may as well not be there. Stretching the range across
  // [min, max] is what makes the variation that *does* exist legible.
  //
  // The ramp also stops well short of white: the scene's bloom threshold is low,
  // and a pure-white surface just blows out.
  const heatmap = useMemo(() => {
    if (!ground || !showTriangles) return null;

    const sampler = buildSurfaceSampler(ground);
    const triN = sampler.cumArea.length;
    const positions = new Float32Array(triN * 9);
    const colors = new Float32Array(triN * 9);

    const areas: number[] = [];
    let minArea = Infinity;
    let maxArea = 0;
    for (let i = 0; i < triN; i++) {
      const a = sampler.cumArea[i] - (i > 0 ? sampler.cumArea[i - 1] : 0);
      areas.push(a);
      if (a < minArea) minArea = a;
      if (a > maxArea) maxArea = a;
    }

    const span = maxArea - minArea;
    const DARK = 0.08;
    const LIGHT = 0.72;

    for (let i = 0; i < triN; i++) {
      for (let v = 0; v < 9; v++) positions[i * 9 + v] = sampler.verts[i * 9 + v];
      // A perfectly uniform mesh has no variation to show — sit it in the middle
      // of the ramp rather than pinning it to one end.
      const t = span > 1e-9 ? (areas[i] - minArea) / span : 0.5;
      const shade = DARK + (LIGHT - DARK) * Math.pow(t, heatGamma);
      for (let v = 0; v < 3; v++) {
        colors[i * 9 + v * 3] = shade;
        colors[i * 9 + v * 3 + 1] = shade;
        colors[i * 9 + v * 3 + 2] = shade;
      }
    }

    console.info(
      `[DebugScatter] ${triN} triangles — area min ${minArea.toFixed(4)} / max ${maxArea.toFixed(4)} u² ` +
        `(${(maxArea / Math.max(minArea, 1e-9)).toFixed(1)}× spread)`,
    );

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [ground, showTriangles, heatGamma]);

  const bbox = useMemo(() => {
    if (!ground || !showBBox) return null;
    return new THREE.Box3Helper(new THREE.Box3().setFromObject(ground), 0x555555);
  }, [ground, showBBox]);

  if (!ground) {
    console.warn(`[DebugScatter] mesh "${groundMesh}" not found in ${url}.`);
    return null;
  }

  return (
    <group>
      {heatmap && (
        <>
          <mesh geometry={heatmap} renderOrder={1}>
            {/* toneMapped off: the shades ARE the data — let the tone mapper
                regrade them and the ramp stops meaning what the panel says. */}
            <meshBasicMaterial
              vertexColors
              toneMapped={false}
              side={THREE.DoubleSide}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
            />
          </mesh>
          {/* Wire on top of the fill, so the triangles being weighted are visible
              as triangles. */}
          <lineSegments renderOrder={2}>
            <wireframeGeometry args={[heatmap]} />
            <lineBasicMaterial color="#00e0ff" transparent opacity={0.35} toneMapped={false} />
          </lineSegments>
        </>
      )}

      {points && (
        // renderOrder above the heat-map (1) and its wireframe (2): with
        // depthTest off the points ignore depth, but they still obey draw ORDER —
        // left at the default 0 they get painted first and the heat-map covers
        // them.
        <points geometry={points} renderOrder={3}>
          <pointsMaterial
            vertexColors
            size={pointSize}
            sizeAttenuation
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      )}

      {bbox && <primitive object={bbox} />}

      {showStats && stats && (
        <Html fullscreen style={{ pointerEvents: "none" }} zIndexRange={[40, 40]}>
          <div
            style={{
              position: "absolute",
              top: 140,
              left: 28,
              minWidth: 290,
              padding: "14px 16px",
              border: "1px solid #2c2c2c",
              borderRadius: 6,
              background: "rgba(8,8,8,0.82)",
              fontFamily: "var(--font-ibm-mono), monospace",
              fontSize: 11,
              lineHeight: 1.8,
              color: "#d8d8d8",
            }}
          >
            <div
              style={{ letterSpacing: "0.18em", color: "#7a7a7a", marginBottom: 6 }}
            >
              PLACEMENT
            </div>

            <Row label="Surface area" value={`${stats.area.toFixed(1)} u²`} />
            <Row label="Triangles" value={stats.triangles.toLocaleString()} />

            <div style={{ height: 1, background: "#242424", margin: "8px 0" }} />

            {/* The whole idea in one line: count isn't chosen, it's derived. */}
            <Row label="Density" value={`${stats.density} pts / u²`} />
            <Row
              label="× Surface area"
              value={`${stats.area.toFixed(1)} u²`}
              color="#7a7a7a"
            />
            <Row
              label="= Blades"
              value={stats.count.toLocaleString()}
              color="#7dff5a"
            />

            {reveal < 1 && (
              <Row
                label="Shown"
                value={`${Math.round(stats.count * reveal).toLocaleString()} (${Math.round(reveal * 100)}%)`}
                color="#e8c15a"
              />
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
      <span style={{ color: "#7a7a7a" }}>{label}</span>
      <span style={{ color: color ?? "#f0f0f0" }}>{value}</span>
    </div>
  );
}
