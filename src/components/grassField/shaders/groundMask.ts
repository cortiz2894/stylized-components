// ─────────────────────────────────────────────────────────────────────────────
// Ground colormap — a procedural dirt mask in world XZ.
//
// Shared verbatim by the ground material and the blade material so both agree on
// where the dirt is: the ground paints it, and the blades standing on it get
// shorter and take its color. That agreement is the whole trick — it makes the
// transition read as grass thinning out into bare earth rather than as a texture
// swap with a hard edge.
//
// groundDirt() returns 0 (full grass) → 1 (bare dirt).
// ─────────────────────────────────────────────────────────────────────────────

export const GROUND_MASK_UNIFORMS = /* glsl */ `
  uniform vec3  uDirtColor;
  uniform float uDirtScale;      // patch size (world units⁻¹)
  uniform float uDirtCoverage;   // 0 = no dirt, 1 = all dirt
  uniform float uDirtSoftness;   // width of the grass→dirt transition
  uniform float uDirtWarp;       // domain warp — breaks up the round blobs
`;

export const GROUND_MASK_GLSL = /* glsl */ `
  float _gmHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  float _gmNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(_gmHash(i),                  _gmHash(i + vec2(1.0, 0.0)), u.x),
      mix(_gmHash(i + vec2(0.0, 1.0)), _gmHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float _gmFbm(vec2 p) {
    float v = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 4; i++) {
      v += a * _gmNoise(p);
      n += a;
      p = p * 2.03 + vec2(3.1, 7.7);
      a *= 0.5;
    }
    return v / max(n, 0.001);
  }

  float groundDirt(vec2 worldXZ) {
    vec2 p = worldXZ * uDirtScale;
    // Warp the sample point by another noise octave so patches get ragged,
    // organic outlines instead of smooth blobs.
    if (uDirtWarp > 0.001) {
      vec2 w = vec2(_gmFbm(p + vec2(11.3, 2.7)), _gmFbm(p + vec2(5.9, 17.1)));
      p += (w - 0.5) * uDirtWarp;
    }
    float n = _gmFbm(p);
    float threshold = 1.0 - uDirtCoverage;
    return smoothstep(threshold - uDirtSoftness, threshold + uDirtSoftness, n);
  }
`;
