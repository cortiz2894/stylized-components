// ─────────────────────────────────────────────────────────────────────────────
// anisotropicKuwahara — pass 2 of 2, and the one that does the painting.
//
// The Kuwahara filter, in one sentence: split the neighbourhood around a pixel
// into sectors, and take the average colour of whichever sector is the FLATTEST
// (lowest variance). Averaging smooths, but always picking the calmest sector
// means the smoothing never crosses an edge — so the image comes out as flat
// patches of colour meeting at hard boundaries, which is exactly what a loaded
// brush leaves behind. It is a blur that refuses to blur across contours.
//
// ANISOTROPIC is the second half. A circular kernel gives round, soap-bubble
// blobs — the tell of a naive Kuwahara. The structure tensor from pass 1 gives
// the local flow direction, and the kernel is rotated onto it and squeezed by
// how strongly the image flows there:
//
//   flat region  → anisotropy ≈ 0 → the kernel stays round
//   strong edge  → anisotropy ≈ 1 → the kernel stretches ALONG the edge
//
// so strokes follow the form the way a painter's do, and eaves and beams come
// out stroked along their length instead of dissolved into pebbles.
//
// Cost: SECTOR_COUNT × radius × 5 texture fetches per pixel. At the default
// 8 × 5 × 5 that is 200 samples — this is a heavy filter, and `radius` is the
// knob that pays for it.
//
// Adapted from Maxime Heckel's anisotropic Kuwahara implementation. Two
// deliberate departures from that source, both about where this one sits:
//
//   · No `fromLinear()`. That version writes straight to the screen and has to
//     encode sRGB itself; here the pass runs INSIDE postprocessing's composer,
//     which works in linear and lets the final EffectPass do the encoding. Doing
//     it here as well would gamma the image twice.
//   · No separate `originalTexture` render. That version renders the scene a
//     second time into an FBO to have an unfiltered copy to sample; in a proper
//     pass chain the composer's input buffer already IS that copy, so the scene
//     is rendered once.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Debug views. `uDebug` swaps the paint for a picture of one of the filter's
 * own intermediate values — what the structure tensor holds, which way the
 * image flows, how strongly, which sector won.
 *
 * Entirely optional: production only ever uses OFF. The whole block is one
 * uniform, one helper and one `if` chain, all marked in the shader — delete
 * them and the filter is unchanged.
 */
export const KUWAHARA_DEBUG = {
  /** The paint. The only value that matters outside a teaching session. */
  OFF: 0,
  /** Pass 1's raw output: (Jxx, Jyy, |Jxy|), range-compressed. */
  TENSOR: 1,
  /** Flow direction as hue. Sign-blind, so its period is π, not 2π. */
  ORIENTATION: 2,
  /** (λ1 − λ2) / (λ1 + λ2) — how strongly the image flows one way. */
  ANISOTROPY: 3,
  /** Which of the 8 sectors was the flattest, one hue each. */
  SECTOR: 4,
  /** The winning sector's variance — how flat "flattest" actually was. */
  VARIANCE: 5,
  /** The paint with anisotropy forced to 0: the round-kernel naive Kuwahara,
   *  soap-bubble blobs and all. The before to the filter's after. */
  ISOTROPIC: 6,
} as const;

export type KuwaharaDebugMode =
  (typeof KUWAHARA_DEBUG)[keyof typeof KUWAHARA_DEBUG];

export const ANISOTROPIC_KUWAHARA_FRAGMENT = /* glsl */ `
precision highp float;

#define SECTOR_COUNT 8

// ── Debug (optional — see KUWAHARA_DEBUG) ───────────────────────────────────
#define DEBUG_OFF         0
#define DEBUG_TENSOR      1
#define DEBUG_ORIENTATION 2
#define DEBUG_ANISOTROPY  3
#define DEBUG_SECTOR      4
#define DEBUG_VARIANCE    5
#define DEBUG_ISOTROPIC   6

/** Loop bound. GLSL ES 1.00 will not compile a loop tested against a uniform,
 *  so the real radius is applied with an early break instead. Raising this
 *  costs nothing until uRadius actually reaches it. */
const int MAX_RADIUS = 16;

/** The angular sweep of one sector: ±22.5° in 5 steps, as in the original. */
const int ANGLE_STEPS = 5;
const float ANGLE_START = -0.392699;
const float ANGLE_STEP = 0.196349;

varying vec2 vUv;

uniform sampler2D uTensor;
uniform sampler2D uColor;
uniform vec2 uResolution;
uniform float uRadius;
/** Kernel eccentricity limit. Large = rounder kernels; small = the kernel
 *  stretches hard along the flow as soon as there is any anisotropy at all. */
uniform float uAlpha;
/** Weight polynomial — how much of each sector's disc actually counts. */
uniform float uEta;
uniform float uLambda;

// ── Debug uniforms (optional) ───────────────────────────────────────────────
/** One of the DEBUG_* modes above. 0 = off = the paint. */
uniform int uDebug;
/** Before/after wipe: everything left of this UV x shows the untouched input.
 *  0 disables it. Purely a presentation aid. */
uniform float uSplit;

/** Fully saturated hue ramp, for the debug views that map an angle or an index
 *  onto a colour. Debug only. */
vec3 hue2rgb(float h) {
  vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
  return clamp(min(k, 4.0 - k), 0.0, 1.0);
}

vec3 sampleColor(vec2 offset) {
  vec2 coord = (gl_FragCoord.xy + offset) / uResolution;
  return texture2D(uColor, coord).rgb;
}

/**
 * Eigen-decomposition of the 2×2 tensor, by hand.
 *
 * Returns (orientation.xy, lambda1, lambda2): the dominant eigenvector — the
 * direction the image flows — and both eigenvalues, whose spread is how
 * strongly it flows that way rather than every way at once.
 */
vec4 getDominantOrientation(vec4 structureTensor) {
  float Jxx = structureTensor.r;
  float Jyy = structureTensor.g;
  float Jxy = structureTensor.b;

  float trace = Jxx + Jyy;
  float determinant = Jxx * Jyy - Jxy * Jxy;

  float lambda1 = trace * 0.5 + sqrt(max(trace * trace * 0.25 - determinant, 0.0));
  float lambda2 = trace * 0.5 - sqrt(max(trace * trace * 0.25 - determinant, 0.0));

  float jxyStrength = abs(Jxy) / (abs(Jxx) + abs(Jyy) + abs(Jxy) + 1e-6);

  vec2 v;
  if (jxyStrength > 0.0) {
    v = normalize(vec2(-Jxy, Jxx - lambda1));
  } else {
    // No cross term: the gradient is axis-aligned, so there is nothing to
    // rotate onto and the kernel keeps its default orientation.
    v = vec2(0.0, 1.0);
  }

  return vec4(normalize(v), lambda1, lambda2);
}

/** Falls off toward the rim of a sector, so a sample's influence fades instead
 *  of ending on the sector's straight edge — which would print the sector fan
 *  itself into the image. */
float polynomialWeight(float x, float y, float eta, float lambda) {
  float polyValue = (x + eta) - lambda * (y * y);
  return max(0.0, polyValue * polyValue);
}

void getSectorVarianceAndAverageColor(
  mat2 anisotropyMat,
  float angle,
  float radius,
  out vec3 avgColor,
  out float variance
) {
  vec3 weightedColorSum = vec3(0.0);
  vec3 weightedSquaredColorSum = vec3(0.0);
  float totalWeight = 0.0;

  for (int ri = 1; ri <= MAX_RADIUS; ri++) {
    float r = float(ri);
    if (r > radius) break;

    for (int ai = 0; ai < ANGLE_STEPS; ai++) {
      float a = ANGLE_START + float(ai) * ANGLE_STEP;

      vec2 sampleOffset = r * vec2(cos(angle + a), sin(angle + a));
      // Rotate onto the flow and squeeze — this is the "anisotropic" part.
      //
      // M * v, NOT v * M. In GLSL, v * M means transpose(M) * v, which
      // reverses the composition to scale-AFTER-rotate: the disc gets rotated
      // (a disc is rotation-invariant, so nothing happens) and then squashed
      // along the SCREEN axes. The kernel comes out an ellipse whose long axis
      // is always screen-vertical no matter which way the image flows, which
      // is the one thing an anisotropic kernel must not be.
      sampleOffset = anisotropyMat * sampleOffset;

      vec3 color = sampleColor(sampleOffset);
      float weight = polynomialWeight(sampleOffset.x, sampleOffset.y, uEta, uLambda);

      weightedColorSum += color * weight;
      weightedSquaredColorSum += color * color * weight;
      totalWeight += weight;
    }
  }

  float safeWeight = max(totalWeight, 1e-6);
  avgColor = weightedColorSum / safeWeight;
  // E[x²] − E[x]², per channel, then collapsed to luminance: a sector that is
  // flat in brightness but not in hue should still count as flat.
  vec3 varianceRes = (weightedSquaredColorSum / safeWeight) - (avgColor * avgColor);
  variance = dot(varianceRes, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec4 structureTensor = texture2D(uTensor, vUv);

  vec4 orientationAndAnisotropy = getDominantOrientation(structureTensor);
  vec2 orientation = orientationAndAnisotropy.xy;

  // (λ1 − λ2) / (λ1 + λ2): 0 where the image is directionless, →1 on a crisp
  // edge. It is the amount, not the direction.
  float anisotropy = (orientationAndAnisotropy.z - orientationAndAnisotropy.w)
                   / (orientationAndAnisotropy.z + orientationAndAnisotropy.w + 1e-6);

  vec3 outColor = vec3(0.0);
  // Set by the three tensor-only debug views, which are done before the
  // sampling loop below is worth running.
  bool resolved = false;

  // ── Debug: answered by pass 1's output alone ──────────────────────────────
  if (uDebug == DEBUG_TENSOR) {
    // Squared gradient sums are unbounded, so compress rather than clamp:
    // x/(1+x) keeps the whole range on screen instead of blowing out to white
    // everywhere there is an edge.
    vec3 t = vec3(structureTensor.r, structureTensor.g, abs(structureTensor.b));
    outColor = t / (1.0 + t);
    resolved = true;
  } else if (uDebug == DEBUG_ORIENTATION) {
    // Hue = flow angle, dimmed by anisotropy so the flat regions (where the
    // direction is noise) stay dark instead of strobing. The period is π, not
    // 2π: the tensor is sign-blind by construction, so an edge running up-left
    // gets the same hue as the same edge running down-right — which is the
    // property this view exists to show.
    float a = atan(orientation.y, orientation.x);
    outColor = hue2rgb(fract(a / 3.14159265)) * (0.15 + 0.85 * anisotropy);
    resolved = true;
  } else if (uDebug == DEBUG_ANISOTROPY) {
    outColor = vec3(anisotropy);
    resolved = true;
  }

  if (!resolved) {
    // DEBUG_ISOTROPIC drops the anisotropy on the floor: scaleX and scaleY
    // both collapse to 1, the kernel stays a circle, and what comes out is the
    // naive Kuwahara this filter exists to improve on.
    float aniso = (uDebug == DEBUG_ISOTROPIC) ? 0.0 : anisotropy;

    // Eccentricity. Note how fast this saturates: at alpha 1 a fully
    // directional pixel gives 0.5 / 2.0, a 4:1 kernel. At alpha 25 it is
    // 0.96 / 1.04 — a 1.08:1 kernel, which is a circle for all practical
    // purposes. Anything above ~20 turns the anisotropy off in everything but
    // name, so this knob's interesting range is the low single digits.
    float alpha = max(uAlpha, 1e-3);
    float scaleX = alpha / (aniso + alpha);
    float scaleY = (aniso + alpha) / alpha;

    // Columns (o.x, o.y) and (-o.y, o.x): the rotation carrying the local x
    // axis onto the flow direction. Composed BEFORE the scale, so local x is
    // squashed across the edge and local y is stretched along it.
    mat2 rotation = mat2(orientation.x, orientation.y, -orientation.y, orientation.x);
    mat2 anisotropyMat = rotation * mat2(scaleX, 0.0, 0.0, scaleY);

    vec3 sectorAvgColors[SECTOR_COUNT];
    float sectorVariances[SECTOR_COUNT];

    for (int i = 0; i < SECTOR_COUNT; i++) {
      float angle = float(i) * 6.28318 / float(SECTOR_COUNT);
      getSectorVarianceAndAverageColor(
        anisotropyMat, angle, uRadius, sectorAvgColors[i], sectorVariances[i]
      );
    }

    // The filter, in three lines: keep the calmest sector's average.
    float minVariance = sectorVariances[0];
    vec3 finalColor = sectorAvgColors[0];
    int winner = 0;

    for (int i = 1; i < SECTOR_COUNT; i++) {
      if (sectorVariances[i] < minVariance) {
        minVariance = sectorVariances[i];
        finalColor = sectorAvgColors[i];
        winner = i;
      }
    }

    if (uDebug == DEBUG_SECTOR) {
      // One hue per sector. Large flat fields of a single hue are regions the
      // filter smoothed as one patch; the mosaic is where it kept switching.
      outColor = hue2rgb(float(winner) / float(SECTOR_COUNT));
    } else if (uDebug == DEBUG_VARIANCE) {
      // Even the busiest sector's variance is a small number — the sqrt is
      // there to lift it off the floor into something a camera can record.
      outColor = vec3(clamp(sqrt(minVariance) * 4.0, 0.0, 1.0));
    } else {
      outColor = finalColor;
    }
  }

  // ── Before/after wipe (optional) ──────────────────────────────────────────
  // Anything running AFTER this pass has to bypass the same strip or the
  // "before" side is not a before — it is the unpainted scene with the rest of
  // the chain still applied to it. The watercolour grade takes the same uSplit
  // for exactly this reason.
  if (uSplit > 0.0 && vUv.x < uSplit) {
    outColor = texture2D(uColor, vUv).rgb;

    // Hairline, drawn just INSIDE the bypassed strip rather than centred on
    // the seam. A line straddling the boundary would have its right half
    // graded by whatever comes next and its left half not, which reads as a
    // two-tone edge; kept wholly on the bypassed side it stays clean white.
    if (vUv.x > uSplit - 1.5 / uResolution.x) outColor = vec3(1.0);
  }

  gl_FragColor = vec4(outColor, 1.0);
}
`;

/** Shared by both passes: postprocessing's fullscreen triangle already arrives
 *  in clip space, so there is no matrix to apply. */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;
