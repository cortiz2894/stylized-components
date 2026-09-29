import * as THREE from "three";

// ─────────────────────────────────────────────────────────────────────────────
// Where the light can get in.
//
// Everything in this scene that has to know "is this point in the sun?" — the
// floating dust and the raymarched shafts — answers it the same way: follow the
// point TOWARD the sun until it reaches the window wall, and ask whether it came
// out through glass or through plaster. That is exactly the question a shadow
// map answers, asked analytically against a handful of rectangles instead.
//
// The rectangles below are measured off ClassRoom.glb, not guessed: the window
// wall is the plane x = 64 once the Sketchfab root's transform is applied, and
// the openings are what a line scan across that wall found open. Two bands of
// glass — the tall panes and the transom strip above them — split by mullions
// and three curtain pillars.
//
// If the GLB is ever re-exported or moved, these are the numbers to re-measure.
// The floor patches (which come from the real shadow map) will keep telling the
// truth; the dust and the shafts will quietly start lighting the pillars.
// ─────────────────────────────────────────────────────────────────────────────

/** World X of the window wall's outer face. The sun is on the +X side of it. */
export const WINDOW_PLANE_X = 64.0;

/** Open spans along Z, between the mullions and the curtain pillars. */
const Z_SPANS: [number, number][] = [
  [-5.32, -4.74],
  [-3.0, -2.58],
  [-2.46, 0.28],
  [0.66, 3.4],
  [3.5, 5.6],
  [7.34, 9.66],
  [9.78, 12.52],
  [12.9, 15.64],
  [15.76, 16.82],
];

/** Open spans along Y: the tall panes, then the transom strip over the bar. */
const Y_SPANS: [number, number][] = [
  [1.38, 6.14],
  [6.44, 7.92],
];

/**
 * Every pane as (zMin, zMax, yMin, yMax) — the layout the shaders take, so the
 * test is one `min` of two vec2s per pane.
 */
export const WINDOW_PANES: THREE.Vector4[] = Y_SPANS.flatMap(([y0, y1]) =>
  Z_SPANS.map(([z0, z1]) => new THREE.Vector4(z0, z1, y0, y1)),
);

export const PANE_COUNT = WINDOW_PANES.length;

/** The whole glazed area, for a cheap early-out before the per-pane loop. */
export const WINDOW_BOUNDS = new THREE.Vector4(
  Z_SPANS[0][0],
  Z_SPANS[Z_SPANS.length - 1][1],
  Y_SPANS[0][0],
  Y_SPANS[Y_SPANS.length - 1][1],
);

/** The inside of the room — floor to ceiling, back wall to blackboard. What the
 *  shaft march is clipped to: outside it there is no air worth lighting. */
export const ROOM_MIN = new THREE.Vector3(42.7, -0.94, -5.95);
export const ROOM_MAX = new THREE.Vector3(64.0, 9.13, 18.82);

/** Middle of the room, at desk height. What the sun's shadow camera aims at. */
export const ROOM_CENTER: [number, number, number] = [53.4, 2, 6.4];

/**
 * A direction TOWARD the sun from elevation / azimuth in degrees.
 *
 * Same convention as SkyDome — azimuth 0 is +Z, 90 is +X — so the two can be
 * fed the same angle and the disc lands where the light comes from.
 */
export function sunDirection(
  elevationDeg: number,
  azimuthDeg: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elevationDeg);
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  return out.set(
    Math.cos(e) * Math.sin(a),
    Math.sin(e),
    Math.cos(e) * Math.cos(a),
  );
}

/**
 * The shared test, as GLSL — uniforms included, so a shader pastes this in and
 * spreads `windowLightUniforms()` into its own uniforms, and that is the whole
 * hook-up.
 *
 * `windowLight(p)` returns (lit 0..1, distance from the glass along the ray).
 *
 * The penumbra term is the one piece of physics kept on purpose: the sun is a
 * disc, not a point, so a beam's edge blurs the further it gets from the frame
 * that cut it. It is what stops the shafts reading as extruded rectangles.
 */
export const WINDOW_LIGHT_GLSL = /* glsl */ `
#define PANE_COUNT ${PANE_COUNT}

uniform vec3 uSunDir;         // TOWARD the sun, normalised
uniform float uWindowX;
uniform vec4 uPanes[PANE_COUNT];
uniform vec4 uWindowBounds;   // (zMin, zMax, yMin, yMax) of all the glass
uniform float uEdgeSoftness;  // world units, at the glass
uniform float uPenumbra;      // extra softness per unit travelled

vec2 windowLight(vec3 p) {
  // Only light coming IN: the sun is on the +X side, so a point already past
  // the glass (or a sun on the wrong side of the wall) gets nothing.
  if (uSunDir.x <= 1e-4) return vec2(0.0);
  float t = (uWindowX - p.x) / uSunDir.x;
  if (t < 0.0) return vec2(0.0);

  // Where the line from p to the sun crosses the wall, as (z, y).
  vec2 hit = p.zy + uSunDir.zy * t;

  vec4 b = uWindowBounds;
  if (hit.x < b.x || hit.x > b.y || hit.y < b.z || hit.y > b.w) {
    return vec2(0.0, t);
  }

  float soft = max(uEdgeSoftness + t * uPenumbra, 1e-3);
  float lit = 0.0;
  for (int i = 0; i < PANE_COUNT; i++) {
    vec4 r = uPanes[i];
    // Distance inside the pane on each axis; negative is outside.
    vec2 inside = min(hit - r.xz, r.yw - hit);
    lit = max(lit, smoothstep(0.0, soft, min(inside.x, inside.y)));
  }
  return vec2(lit, t);
}
`;

/** Uniforms for WINDOW_LIGHT_GLSL, sharing one sun vector with the caller. */
export function windowLightUniforms(sunDir: THREE.Vector3) {
  return {
    uSunDir: { value: sunDir },
    uWindowX: { value: WINDOW_PLANE_X },
    uPanes: { value: WINDOW_PANES },
    uWindowBounds: { value: WINDOW_BOUNDS },
    uEdgeSoftness: { value: 0.05 },
    uPenumbra: { value: 0.01 },
  };
}

/** World Y of the classroom floor — where a beam volume ends. */
export const FLOOR_Y = ROOM_MIN.y;

/**
 * WINDOW_LIGHT_GLSL on the CPU, hard-edged, for the breakdown helpers that
 * draw the test rather than use it. Writes where the line from `p` toward the
 * sun crosses the window wall into `hitOut`, and says whether that was glass.
 * Returns false (and leaves `hitOut` alone) when the wall is not ahead at all.
 */
export function windowLightAt(
  p: THREE.Vector3,
  sunDir: THREE.Vector3,
  hitOut: THREE.Vector3,
): { crosses: boolean; lit: boolean } {
  if (sunDir.x <= 1e-4) return { crosses: false, lit: false };
  const t = (WINDOW_PLANE_X - p.x) / sunDir.x;
  if (t < 0) return { crosses: false, lit: false };
  hitOut.copy(sunDir).multiplyScalar(t).add(p);
  const lit = WINDOW_PANES.some(
    (r) => hitOut.z > r.x && hitOut.z < r.y && hitOut.y > r.z && hitOut.y < r.w,
  );
  return { crosses: true, lit };
}
