// ─────────────────────────────────────────────────────────────────────────────
// structureTensor — pass 1 of 2.
//
// For every pixel it answers one question: which way does the image FLOW here?
// A 3×3 Sobel gives the gradient (Sx, Sy) per channel, and the outer product of
// that gradient with itself is the structure tensor:
//
//   J = [ Jxx  Jxy ]   packed here as (Jxx, Jyy, Jxy, 1)
//       [ Jxy  Jyy ]
//
// Squared and cross terms rather than the raw gradient, because direction is
// wanted without a sign: an edge running up-left is the same edge running
// down-right, and averaging raw gradients over a neighbourhood would cancel it
// to zero. The tensor's eigenvectors survive that averaging, which is the whole
// reason this representation is used.
//
// The Kuwahara pass then reads this to align its sampling kernel with the flow,
// which is what turns round blobs into directional brush strokes.
// ─────────────────────────────────────────────────────────────────────────────

export const STRUCTURE_TENSOR_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uInput;
uniform vec2 uResolution;

// Sobel kernels — x picks up vertical edges, y horizontal ones.
const mat3 Gx = mat3(-1, -2, -1,  0, 0, 0,  1, 2, 1);
const mat3 Gy = mat3(-1,  0,  1, -2, 0, 2, -1, 0, 1);

vec4 computeStructureTensor(sampler2D tex, vec2 uv) {
  vec2 texel = 1.0 / uResolution;

  vec3 tx0y0 = texture2D(tex, uv + vec2(-1, -1) * texel).rgb;
  vec3 tx0y1 = texture2D(tex, uv + vec2(-1,  0) * texel).rgb;
  vec3 tx0y2 = texture2D(tex, uv + vec2(-1,  1) * texel).rgb;
  vec3 tx1y0 = texture2D(tex, uv + vec2( 0, -1) * texel).rgb;
  vec3 tx1y1 = texture2D(tex, uv + vec2( 0,  0) * texel).rgb;
  vec3 tx1y2 = texture2D(tex, uv + vec2( 0,  1) * texel).rgb;
  vec3 tx2y0 = texture2D(tex, uv + vec2( 1, -1) * texel).rgb;
  vec3 tx2y1 = texture2D(tex, uv + vec2( 1,  0) * texel).rgb;
  vec3 tx2y2 = texture2D(tex, uv + vec2( 1,  1) * texel).rgb;

  vec3 Sx = Gx[0][0] * tx0y0 + Gx[1][0] * tx1y0 + Gx[2][0] * tx2y0 +
            Gx[0][1] * tx0y1 + Gx[1][1] * tx1y1 + Gx[2][1] * tx2y1 +
            Gx[0][2] * tx0y2 + Gx[1][2] * tx1y2 + Gx[2][2] * tx2y2;

  vec3 Sy = Gy[0][0] * tx0y0 + Gy[1][0] * tx1y0 + Gy[2][0] * tx2y0 +
            Gy[0][1] * tx0y1 + Gy[1][1] * tx1y1 + Gy[2][1] * tx2y1 +
            Gy[0][2] * tx0y2 + Gy[1][2] * tx1y2 + Gy[2][2] * tx2y2;

  return vec4(dot(Sx, Sx), dot(Sy, Sy), dot(Sx, Sy), 1.0);
}

void main() {
  gl_FragColor = computeStructureTensor(uInput, vUv);
}
`;
