// ─────────────────────────────────────────────────────────────────────────────
// volumetricLight — god rays / crepuscular shafts, in screen space.
//
// The light shafts in the reference are not a volume being integrated. They are
// the SHADOW of everything standing between the camera and the sun, smeared
// along the direction the light arrives from — which in screen space is simply
// "away from the sun's pixel". So the whole effect is a radial blur of a mask
// that says where light is coming through, marched from each pixel TOWARD the
// sun:
//
//   pixel ──► ──► ──► ──► ☀
//            ▲ each step asks "is there open sky here?"
//
// A pixel whose path to the sun crosses a trunk collects nothing and stays dark;
// one that looks through a gap in the canopy collects sky the whole way and
// lights up. That is the shaft, and it costs one texture fetch per step.
//
// Two shaders, and the split is what makes this affordable:
//
//   1. MASK  — full-res depth + colour reduced to a single "light gets through
//              here" image, rendered once into a half-res target.
//   2. RAYS  — the march itself, sampling ONLY that small target. One fetch per
//              step instead of two, out of a texture small enough to stay in
//              cache, and the downsample doubles as a free blur (shafts want to
//              be soft, so the resolution loss is not a compromise here).
//
// Depth is used as a binary "is this sky", never reconstructed to a world
// position — the shafts do not care how far away the canopy is, only that it is
// in the way.
// ─────────────────────────────────────────────────────────────────────────────

/** Fullscreen triangle, already in clip space — same as the fog pass's. */
export const VOLUMETRIC_LIGHT_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

// ── Pass 1: the emitter mask ────────────────────────────────────────────────
export const VOLUMETRIC_LIGHT_MASK_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uColor;
uniform sampler2D uDepth;

/** Luminance a pixel needs before it counts as a light source, and how sharply
 *  that cuts in. This is what keeps a night sky from throwing shafts. */
uniform float uThreshold;
uniform float uSoftness;
/** 1 = only pixels the depth buffer left cleared (the sky) may emit.
 *  Lower it to let bright GEOMETRY throw shafts too — a lantern, a fire. */
uniform float uSkyOnly;

// The cleared depth, i.e. sky — NOT merely "far away". A depth buffer is
// violently non-linear: with this scene's near 0.1 / far 3000, a fragment 1000
// units out already sits at 0.99993, so a loose threshold hands the shafts
// straight through the far half of the level. Five nines cuts at ~2300 units,
// past everything the scene draws, and is not tighter only because a 16-bit
// depth attachment quantises at ~1.5e-5.
//
// The sky dome itself writes no depth (depthWrite false — it is a backdrop), so
// it lands here correctly as open sky, which is the entire premise.
const float VL_SKY = 0.99999;

void main() {
  vec3 c = texture2D(uColor, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Sky-ness. Kept as a multiplier rather than a branch so uSkyOnly can be dialled
  // between "only the sky emits" and "anything bright emits".
  float open = mix(1.0, step(VL_SKY, texture2D(uDepth, vUv).x), uSkyOnly);
  float lit = smoothstep(uThreshold, uThreshold + max(uSoftness, 1e-3), lum);

  // The mask keeps the source's COLOUR, not just its strength: shafts coming
  // out of a warm horizon should arrive warm, and out of a cold one, cold. The
  // tint control downstream biases that, it does not replace it.
  gl_FragColor = vec4(c * lit * open, 1.0);
}
`;

// ── Pass 2: the radial march ────────────────────────────────────────────────
export const VOLUMETRIC_LIGHT_RAYS_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uColor;   // the scene, untouched
uniform sampler2D uMask;    // pass 1, at half resolution
/** 0 = composite, 1 = show the mask, 2 = shafts alone on black. */
uniform int uDebugView;

/** Where the sun DISC is on screen, and whether it is worth marching toward.
 *  Written from the sky dome's own disc position — see the pass. */
uniform vec2  uSunUv;
uniform float uVisible;
uniform float uAspect;

uniform float uIntensity;
/** How far along the pixel→sun line the march walks, as a fraction of that
 *  distance. 1 = all the way to the disc; below that the shafts stop short of
 *  it and read as separate beams rather than one blown-out star. */
uniform float uDensity;
/** Per-step falloff. Below 1, near samples count for more than far ones, so a
 *  shaft fades along its own length instead of ending. */
uniform float uDecay;
uniform int   uSamples;
/** Fraction of one step each pixel is offset by, from a hash. Without it a
 *  low sample count draws the march as visible concentric arcs. */
uniform float uDither;

/** How far from the disc the shafts reach, in screen heights, and the curve of
 *  that falloff. Past ~1.5 the cut is off-frame, i.e. effectively off. */
uniform float uReach;
uniform float uReachPow;

uniform vec3  uTint;
/** 0 = shafts keep the sky's own colour, 1 = fully replaced by uTint. */
uniform float uTintMix;

/** Strand break-up: dust in the air, so the shafts are not a clean fan. */
uniform float uNoiseAmount;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uTime;

#define VL_MAX_SAMPLES 64

float vlHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float vlNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(vlHash(i),                  vlHash(i + vec2(1.0, 0.0)), f.x),
    mix(vlHash(i + vec2(0.0, 1.0)), vlHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

/** Fades a sample as it leaves the frame. The mask target is clamp-to-edge, so
 *  without this a sun just off screen smears its border row inward as a set of
 *  hard streaks. */
float vlInBounds(vec2 uv) {
  vec2 e = smoothstep(vec2(0.0), vec2(0.03), uv) *
           smoothstep(vec2(1.0), vec2(0.97), uv);
  return e.x * e.y;
}

void main() {
  // The two debug views: what the march READS (the mask of sky bright enough
  // to emit) and what it WRITES (the shafts, with the scene taken away).
  if (uDebugView == 1) { gl_FragColor = vec4(texture2D(uMask, vUv).rgb, 1.0); return; }
  vec4 base = uDebugView == 2 ? vec4(0.0, 0.0, 0.0, 1.0) : texture2D(uColor, vUv);

  // uVisible is 0 with the sun behind the camera, where "toward the sun" on
  // screen points at its mirror image and the shafts would run backwards.
  if (uIntensity <= 0.0 || uVisible <= 0.0) { gl_FragColor = base; return; }

  vec2 d = vUv - uSunUv;

  // Distance in screen HEIGHTS, so the reach does not change with the window's
  // aspect ratio.
  float dist = length(d * vec2(uAspect, 1.0));
  float reach = pow(clamp(1.0 - dist / max(uReach, 1e-3), 0.0, 1.0), uReachPow);
  if (reach <= 0.001) { gl_FragColor = base; return; }

  // The step is a fraction of THIS pixel's distance to the sun, not a fixed
  // length: every pixel therefore takes the same number of steps to cover its
  // own line, and the shafts stay coherent across the frame instead of getting
  // shorter as they get further out.
  vec2 stepUv = d * (uDensity / float(uSamples));

  vec2 uv = vUv - stepUv * (vlHash(gl_FragCoord.xy) * uDither);

  vec3 acc = vec3(0.0);
  float w = 1.0;
  float wsum = 0.0;

  for (int i = 0; i < VL_MAX_SAMPLES; i++) {
    if (i >= uSamples) break;
    uv -= stepUv;
    acc += texture2D(uMask, clamp(uv, 0.0, 1.0)).rgb * (w * vlInBounds(uv));
    wsum += w;
    w *= uDecay;
  }

  // Normalised by the weights actually used, not by the sample count — so the
  // Samples slider is a QUALITY knob and moving it does not change how bright
  // the scene is. The result is a weighted average of the mask, 0..1.
  acc /= max(wsum, 1e-4);

  // ── Strands ───────────────────────────────────────────────────────────────
  // Modulated in polar coordinates around the disc: the angle term is what
  // splits the fan into separate beams, and the small radial term keeps those
  // beams from being perfectly straight-edged wedges. Slow drift only — this is
  // dust hanging in the air, not smoke.
  float strands = 1.0;
  if (uNoiseAmount > 0.001) {
    vec2 da = d * vec2(uAspect, 1.0);
    // atan(0, 0) is undefined and NaN on some drivers — which additive blending
    // then spreads outward from the one pixel dead on the disc. The epsilon is
    // far below a pixel and costs nothing anywhere else.
    float ang = atan(da.y, da.x + 1e-6);
    float n = vlNoise(vec2(ang * uNoiseScale, dist * 3.0 + uTime * uNoiseSpeed));
    // Remapped around 1 so the strands REDISTRIBUTE the light rather than add
    // it: turning them up cannot make the frame brighter, only less even.
    strands = mix(1.0, 0.3 + 1.4 * smoothstep(0.25, 0.75, n), uNoiseAmount);
  }

  // Tint biases toward a colour at constant strength — mixing toward the tint
  // scaled by the shaft's own peak channel, so a warm shaft can be pushed
  // warmer without a dark one being lifted out of nothing.
  vec3 shaft = mix(acc, uTint * max(max(acc.r, acc.g), acc.b), uTintMix);

  gl_FragColor = vec4(
    base.rgb + shaft * (uIntensity * reach * strands * uVisible),
    base.a
  );
}
`;
