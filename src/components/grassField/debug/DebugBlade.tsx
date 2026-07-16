"use client";

import { useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { makeBladeGeometry } from "../materials/bladeMaterial";

// ─────────────────────────────────────────────────────────────────────────────
// DebugBlade — one blade, blown up. Built for the breakdown video.
//
// It calls the SAME makeBladeGeometry() the field instances fifty thousand
// times, so what's on screen is the real thing, not a diagram of it.
//
// Two things worth knowing before you film it:
//
//   PROPORTIONS. The geometry is authored at unit size — base width 1, height 1 —
//   and the instance matrix is what makes a real blade slender (roughly 0.06 wide
//   by 0.25 tall, so ~4× taller than it is wide). Shown 1:1 the blade looks like
//   a fat triangle, which is honest about the data and misleading about the look.
//   "Real Proportions" applies the field's own aspect ratio.
//
//   SEGMENTS. Wind displaces vertices, so a blade bends along a POLYLINE with one
//   joint per segment, not along a curve. Topology caps what's reachable: a
//   tapered strip has 2·segments − 1 triangles, so the count is always odd —
//   5, 7, 9 — never 6.
// ─────────────────────────────────────────────────────────────────────────────

export default function DebugBlade() {
  const groupRef = useRef<THREE.Group>(null);

  const {
    segments,
    realProportions,
    scale,
    spin,
    spinSpeed,
    showGradient,
    showWireframe,
    showVerts,
    showLabels,
    showAxis,
  } = useControls(
    "Debug Blade",
    {
      segments: {
        value: 3,
        min: 1,
        max: 8,
        step: 1,
        label: "Segments (2·n−1 tris)",
      },
      realProportions: { value: false, label: "Real Proportions (0.06 × 0.25)" },
      scale: { value: 4, min: 0.5, max: 14, step: 0.5, label: "Scale" },
      spin: { value: true, label: "Auto Spin" },
      spinSpeed: { value: 0.3, min: 0, max: 2, step: 0.05, label: "Spin Speed" },
      showGradient: { value: true, label: "Height Gradient (y: 0 → 1)" },
      showWireframe: { value: true, label: "Wireframe" },
      showVerts: { value: true, label: "Vertices" },
      showLabels: { value: true, label: "Labels (v0…v6)" },
      showAxis: { value: true, label: "Height Axis" },
    },
    { collapsed: false },
  );

  const geometry = useMemo(() => makeBladeGeometry(segments), [segments]);

  /** Local-space vertices of the current geometry — read straight back out, so
   *  the labels can never disagree with what's drawn. */
  const verts = useMemo(() => {
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    return Array.from({ length: pos.count }, (_, i) => [
      pos.getX(i),
      pos.getY(i),
      pos.getZ(i),
    ]) as [number, number, number][];
  }, [geometry]);

  const vertGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
    return g;
  }, [verts]);

  useFrame((_, delta) => {
    if (spin && groupRef.current) groupRef.current.rotation.y += delta * spinSpeed;
  });

  // The height ramp, painted straight onto the blade: black at the base, white at
  // the tip — the same `position.y` the real shader carries as vBH.
  const heightMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying float vH;
          void main() {
            vH = position.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vH;
          void main() {
            gl_FragColor = vec4(vec3(vH), 1.0);
          }
        `,
      }),
    [],
  );

  // A real blade is ~0.06 wide and ~0.25 long; squashing X by that ratio shows the
  // silhouette the field actually renders, without touching the geometry.
  const aspect = realProportions ? 0.06 / 0.25 : 1;

  return (
    <group ref={groupRef} position={[0, 0.1, 0]} scale={[scale * aspect, scale, scale]}>
      <mesh geometry={geometry}>
        {showGradient ? (
          <primitive object={heightMaterial} attach="material" />
        ) : (
          <meshBasicMaterial color="#5c8338" side={THREE.DoubleSide} />
        )}
      </mesh>

      {showWireframe && (
        <lineSegments>
          <wireframeGeometry args={[geometry]} />
          <lineBasicMaterial color="#ffffff" transparent opacity={0.55} />
        </lineSegments>
      )}

      {showVerts && (
        <points geometry={vertGeometry}>
          <pointsMaterial
            color="#ff3b30"
            size={0.06}
            sizeAttenuation
            depthTest={false}
          />
        </points>
      )}

      {showLabels &&
        verts.map(([x, y, z], i) => (
          <Html
            key={i}
            position={[x + (x < 0 ? -0.1 : 0.1), y, z]}
            center
            // Counter-scale, or the labels inherit the blade's aspect squash.
            style={{
              fontFamily: "var(--font-ibm-mono), monospace",
              fontSize: 10,
              letterSpacing: "0.1em",
              color: "#fff",
              background: "rgba(0,0,0,0.65)",
              padding: "2px 5px",
              borderRadius: 3,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {`v${i} · y=${y.toFixed(2)}`}
          </Html>
        ))}

      {showAxis && (
        <>
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([0.75, 0, 0, 0.75, 1, 0]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#666666" />
          </line>
          <Html
            position={[0.95, 0, 0]}
            center
            style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}
          >
            y = 0
          </Html>
          <Html
            position={[0.95, 1, 0]}
            center
            style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}
          >
            y = 1
          </Html>
        </>
      )}
    </group>
  );
}
