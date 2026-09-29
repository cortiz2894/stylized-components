import * as THREE from "three";
import { Pass } from "postprocessing";
import {
  ROOM_MAX,
  ROOM_MIN,
  WINDOW_LIGHT_GLSL,
  windowLightUniforms,
} from "./classroomWindows";

// ─────────────────────────────────────────────────────────────────────────────
// WindowShaftsPass — the beams, marched through the room in WORLD space.
//
// The screen-space god rays (VolumetricLightPass) smear the sky toward the sun's
// pixel, which is gorgeous when the sun is in frame and says nothing about WHERE
// in the room the light is. These are the other half: for every pixel, walk the
// camera ray through the air of the room, and at each step ask the window test
// "can this point see the sun?". Sum the yeses and you have the amount of lit
// air in front of that pixel — which is all a light shaft is.
//
//   camera ──●────●────●────●────●────●──► wall / desk (scene depth)
//                 ☀    ☀    ☀              ← steps inside a beam add light
//
// Three things keep it honest and cheap:
//
//   · The march stops at the SCENE DEPTH, so a desk in front of a beam hides
//     the part of the beam behind it, and the beam ends where it hits the floor.
//   · The ray is clipped to the room's box first; the sky through the window
//     costs nothing because the ray has left the room by then.
//   · Each pixel starts its march at a different offset (interleaved gradient
//     noise), so 40 steps read like far more — the banding you would get from a
//     fixed start turns into fine grain the bloom then softens away.
// ─────────────────────────────────────────────────────────────────────────────

export interface WindowShaftsOptions {
  intensity?: number;
  color?: THREE.ColorRepresentation;
  /** How much light each unit of lit air contributes. */
  density?: number;
  /** How fast a beam fades with distance from the glass. */
  fade?: number;
  /** Beam edge softness at the glass, and how much it widens per unit. */
  edgeSoftness?: number;
  penumbra?: number;
  /** Breaks the beams up with drifting dust. 0 = perfectly even air. */
  noiseAmount?: number;
  noiseScale?: number;
  noiseSpeed?: number;
  /** Samples along each ray. Up to MAX_STEPS; the default is the shipped look. */
  steps?: number;
}

/** The loop's compile-time ceiling — GLSL wants a constant bound, so the live
 *  step count is a uniform that breaks out early. */
export const MAX_STEPS = 64;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrixWorld;
uniform vec3 uCameraPos;

uniform vec3 uRoomMin;
uniform vec3 uRoomMax;

uniform vec3 uLightColor;
uniform float uIntensity;
uniform float uDensity;
uniform float uFade;
uniform float uNoiseAmount;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uTime;
uniform int uSteps;
/** 1 = per-pixel start offset (the shipped look), 0 = every ray starts at the
 *  same place — which is how you SEE the steps, as bands. */
uniform float uJitter;
/** 0 = composite, 1 = the shafts alone on black. */
uniform int uDebugView;

${WINDOW_LIGHT_GLSL}

#define MAX_STEPS ${MAX_STEPS}

vec3 worldFromDepth(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInverseProjection * ndc;
  view /= view.w;
  return (uCameraMatrixWorld * view).xyz;
}

// Jimenez's interleaved gradient noise: a per-pixel offset that tiles without
// visible structure, which is what turns step banding into grain.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// Air that is thicker in some places than others. Stretched ALONG the sun
// direction, so the variation runs down the length of a beam as streaks rather
// than sitting in it as blobs — which is what real dusty light looks like.
float airDensity(vec3 p) {
  vec3 along = uSunDir * dot(p, uSunDir);
  vec3 across = p - along;
  vec3 q = (across + along * 0.25) * uNoiseScale;
  q += vec3(0.0, uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.6);
  float n = valueNoise(q) * 0.65 + valueNoise(q * 2.3) * 0.35;
  return mix(1.0, n * 1.6, uNoiseAmount);
}

void main() {
  vec4 color = uDebugView == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : texture2D(uColor, vUv);
  float depth = texture2D(uDepth, vUv).x;

  vec3 world = worldFromDepth(vUv, depth);
  vec3 ray = world - uCameraPos;
  float sceneDist = length(ray);
  vec3 dir = ray / max(sceneDist, 1e-6);

  // ── Clip to the room ──────────────────────────────────────────────────────
  // Slab test. An axis-aligned ray would divide by zero, so nudge it off-axis.
  vec3 inv = 1.0 / mix(dir, vec3(1e-5), vec3(lessThan(abs(dir), vec3(1e-5))));
  vec3 t0 = (uRoomMin - uCameraPos) * inv;
  vec3 t1 = (uRoomMax - uCameraPos) * inv;
  vec3 tLo = min(t0, t1);
  vec3 tHi = max(t0, t1);
  float tEnter = max(max(max(tLo.x, tLo.y), tLo.z), 0.0);
  float tExit = min(min(tHi.x, tHi.y), tHi.z);
  // The sky (depth 1) sits on the far plane, so for it this is just the exit.
  float tEnd = min(tExit, sceneDist);

  if (tEnd <= tEnter || uIntensity <= 0.0) {
    gl_FragColor = color;
    return;
  }

  // ── March ─────────────────────────────────────────────────────────────────
  float stepLen = (tEnd - tEnter) / float(uSteps);
  float jitter = mix(0.5, ign(gl_FragCoord.xy), uJitter);
  float lightSum = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;
    float t = tEnter + (float(i) + jitter) * stepLen;
    vec3 p = uCameraPos + dir * t;
    vec2 wl = windowLight(p);
    if (wl.x > 0.0) {
      // Light thins out the further it has travelled into the room.
      lightSum += wl.x * exp(-wl.y * uFade) * airDensity(p);
    }
  }

  // Optical depth → how much light reaches the eye. The exponential keeps a
  // pixel that looks down the length of a beam from blowing out linearly.
  float amount = 1.0 - exp(-lightSum * stepLen * uDensity);

  gl_FragColor = vec4(color.rgb + uLightColor * amount * uIntensity, color.a);
}
`;

export class WindowShaftsPass extends Pass {
  private readonly material: THREE.ShaderMaterial;

  /** The SCENE camera, for turning depth back into world positions. The base
   *  Pass's own `camera` is the fullscreen triangle's. */
  sceneCamera: THREE.Camera | null = null;

  constructor(
    sunDir: THREE.Vector3,
    {
      intensity = 1,
      color = "#ffc27a",
      density = 0.12,
      fade = 0.03,
      edgeSoftness = 0.08,
      penumbra = 0.015,
      noiseAmount = 0.5,
      noiseScale = 0.6,
      noiseSpeed = 0.08,
      steps = 40,
    }: WindowShaftsOptions = {},
  ) {
    super("WindowShaftsPass");

    this.needsSwap = true;
    this.needsDepthTexture = true;

    const windowUniforms = windowLightUniforms(sunDir);
    windowUniforms.uEdgeSoftness.value = edgeSoftness;
    windowUniforms.uPenumbra.value = penumbra;

    this.material = new THREE.ShaderMaterial({
      name: "WindowShaftsMaterial",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        ...windowUniforms,
        uColor: { value: null },
        uDepth: { value: null },
        uInverseProjection: { value: new THREE.Matrix4() },
        uCameraMatrixWorld: { value: new THREE.Matrix4() },
        uCameraPos: { value: new THREE.Vector3() },
        uRoomMin: { value: ROOM_MIN.clone() },
        uRoomMax: { value: ROOM_MAX.clone() },
        uLightColor: { value: new THREE.Color(color) },
        uIntensity: { value: intensity },
        uDensity: { value: density },
        uFade: { value: fade },
        uNoiseAmount: { value: noiseAmount },
        uNoiseScale: { value: noiseScale },
        uNoiseSpeed: { value: noiseSpeed },
        uTime: { value: 0 },
        uSteps: { value: steps },
        uJitter: { value: 1 },
        uDebugView: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.fullscreenMaterial = this.material;
  }

  override set mainCamera(value: THREE.Camera) {
    this.sceneCamera = value;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.material.uniforms.uDepth.value = depthTexture;
  }

  /** Live uniforms — every knob is one, so a panel writes straight in. */
  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    u.uColor.value = inputBuffer.texture;

    const cam = this.sceneCamera;
    if (cam) {
      (u.uInverseProjection.value as THREE.Matrix4).copy(
        cam.projectionMatrixInverse,
      );
      (u.uCameraMatrixWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
      cam.getWorldPosition(u.uCameraPos.value as THREE.Vector3);
    }

    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
