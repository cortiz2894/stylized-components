// ─────────────────────────────────────────────────────────────────────────────
// Flower GLSL.
//
// The wind snippet is shared by the VISIBLE material and the DEPTH material used
// for shadow casting. They must run the identical formula: if the shadow pass
// skipped the wind, each flower's shadow would stand still while the flower
// swayed out of it. Keeping one source for both is what prevents that drift.
//
// It operates on `transformed` (the output of <begin_vertex>) so it can be
// injected into a stock Three material, and leaves gl_Position to
// <project_vertex>, which already knows how to fold in instanceMatrix.
// ─────────────────────────────────────────────────────────────────────────────

export const FLOWER_WIND_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uWindFreq;
  uniform float uWindTurb;
  uniform float uWindLean;
  uniform vec2  uWindDir;
  uniform float uBendAmp;
  uniform float uBendFreq;
  uniform float uFlDirtMax; // flowers vanish where the dirt mask exceeds this
  varying vec2  vFlUv;
`;

export const FLOWER_WIND_VERTEX = /* glsl */ `
  #include <begin_vertex>
  vFlUv = uv;

  // ── Cull on dirt ──────────────────────────────────────────────────────────
  // Flowers grow in grass, not on bare earth. The mask is sampled at the
  // flower's BASE (the instance matrix's translation) with the very same
  // groundDirt() the ground and the blades use, so all three agree on where the
  // patches are — sampling it here rather than filtering on the CPU also keeps
  // the Coverage slider live, with no instance respawn.
  //
  // Collapsing the quad to a point (rather than discarding in the fragment
  // shader) costs nothing: the triangles come out zero-area and never rasterize,
  // in the depth pass too — so the flower's shadow disappears with it.
  #ifdef USE_INSTANCING
    vec2 _flBaseXZ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  #else
    vec2 _flBaseXZ = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  #endif
  if (groundDirt(_flBaseXZ) > uFlDirtMax) {
    transformed = vec3(0.0);
  }

  // Quadratic height mask: the base stays pinned, the tip swings the most.
  float _flH = transformed.y * transformed.y;

  #ifdef USE_INSTANCING
    vec3 _flWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    // Wind is a world-space vector but transformed is instance-local, and every
    // flower has a random Y rotation — bring the wind into local space or the
    // flowers fan out instead of leaning together.
    mat3 _flRot = mat3(
      normalize(vec3(instanceMatrix[0])),
      normalize(vec3(instanceMatrix[1])),
      normalize(vec3(instanceMatrix[2]))
    );
    vec3 _flWindLocal = transpose(_flRot) * vec3(uWindDir.x, 0.0, uWindDir.y);
  #else
    vec3 _flWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vec3 _flWindLocal = vec3(uWindDir.x, 0.0, uWindDir.y);
  #endif

  float _flPrimary = sin(dot(_flWorld.xz, uWindDir) * uWindFreq + uTime * uWindSpeed);
  float _flSecond  = sin(dot(_flWorld.xz, uWindDir) * uWindFreq * 2.6 + uTime * uWindSpeed * 1.8 + 1.3) * 0.35;
  vec2  _flPerp    = vec2(-uWindDir.y, uWindDir.x);
  float _flTurb    = sin(dot(_flWorld.xz, _flPerp) * uWindFreq * 1.9 + uTime * uWindSpeed * 0.7 + 2.6) * uWindTurb;

  transformed += _flWindLocal * ((_flPrimary + _flSecond + _flTurb) * uWindStrength * _flH + uWindLean * _flH);
  transformed.x += sin(transformed.y * uBendFreq + uTime * uWindSpeed * 0.4 + _flWorld.x * 0.7) * uBendAmp * _flH;
`;

// ── Fragment: palette lookup ─────────────────────────────────────────────────
//
// A flower is authored as three maps that share one UV layout:
//   flowers.png          alpha mask   — r < 0.5 is discarded (the cut-out shape)
//   flowersRGB.png       color zones  — the dominant R/G/B channel picks a
//                                       palette slot; a neutral pixel = stem/leaf
//   flowersGradient.png  base→tip fade — the bottom of the quad blends into the
//                                       grass color, so there is no hard cut at
//                                       the ground
//
// Replaces `vec4 diffuseColor = vec4( diffuse, opacity );` in a Lambert shader.
export const FLOWER_UNIFORMS = /* glsl */ `
  varying vec2 vFlUv;
  uniform sampler2D uFlowerMask;
  uniform sampler2D uFlowerRGB;
  uniform sampler2D uFlowerGradient;
  uniform vec3  uColorR;
  uniform vec3  uColorG;
  uniform vec3  uColorB;
  uniform vec3  uColorStem;
  uniform vec3  uGrassColor;
  uniform float uBrightness;
`;

export const FLOWER_DIFFUSE = /* glsl */ `
  if ( texture2D( uFlowerMask, vFlUv ).r < 0.5 ) discard;

  float _gradFade = smoothstep( 0.0, 0.7, texture2D( uFlowerGradient, vFlUv ).r );
  vec3  _rgb = texture2D( uFlowerRGB, vFlUv ).rgb;

  float _isR = max( 0.0, _rgb.r - max( _rgb.g, _rgb.b ) );
  float _isG = max( 0.0, _rgb.g - max( _rgb.r, _rgb.b ) );
  float _isB = max( 0.0, _rgb.b - max( _rgb.r, _rgb.g ) );
  float _isW = min( _rgb.r, min( _rgb.g, _rgb.b ) );
  float _tot = _isR + _isG + _isB + _isW;
  vec3  _fc  = _tot < 0.01 ? uColorStem :
    ( _isR * uColorR + _isG * uColorG + _isB * uColorB + _isW * uColorStem ) / _tot;

  vec3 _flCol = mix( uGrassColor, _fc, _gradFade ) * uBrightness;
  vec4 diffuseColor = vec4( _flCol, opacity );
`;
