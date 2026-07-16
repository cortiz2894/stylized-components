// ─────────────────────────────────────────────────────────────────────────────
// Blade GLSL — injected into a MeshLambertMaterial via onBeforeCompile.
//
//   GRASS_BLADE_UNIFORMS  goes after  #include <common>       (vertex)
//   GRASS_BLADE_VERTEX    replaces    #include <begin_vertex>
//   GRASS_SHADOW_VERTEX   replaces    #include <worldpos_vertex>
//
// A blade is a 7-vertex strip, y = 0 at the base and y = 1 at the tip (see
// makeGrassBladeGeometry). Three effects ride on that height:
//   · wind      — quadratic height mask, so the base stays pinned to the ground
//   · dirt      — blades over a dirt patch are shortened and recolored
//   · trampling — blades under a rock are pressed flat and splayed outward
// ─────────────────────────────────────────────────────────────────────────────

/** Max rocks the blade shader can be trampled by. GLSL uniform arrays are fixed
 *  size, so this is a hard cap; uRockCount limits how many are actually read. */
export const MAX_ROCKS = 24;

/** Shadow taps per blade. The shadow is sampled at this many points up the blade
 *  and averaged — a fixed-size varying array, so it's a compile-time max;
 *  uShadowSamples chooses how many are actually read. */
export const MAX_SHADOW_TAPS = 4;

export const GRASS_BLADE_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uWindFreq;
  uniform float uWindTurb;
  uniform float uWindLean;
  uniform vec2  uWindDir;

  varying float vBH;        // blade height [0 = base, 1 = tip], after shrinking
  varying vec3  vWorldPos;
  // The blade's own world-space normal. Lighting deliberately flattens the
  // shading normal to +Y (see makeGrassBladeMaterial) so blades don't shimmer,
  // but translucency needs to know which way the blade actually faces.
  varying vec3  vBladeN;
  // Dirt mask sampled once at the blade's BASE (not per-vertex) so a blade is
  // uniformly "on dirt" or "on grass" and isn't shaded across the patch edge.
  varying float vDirt;
  // How hard the nearest rock presses on this blade. Only the debug view reads
  // it in the fragment stage; the flattening itself happens in the vertex.
  varying float vRockInfl;

  // ── Breakdown switches ────────────────────────────────────────────────────
  // uWindFixLocal = 0 reintroduces the fan-out bug on purpose (see below), so it
  // can be filmed live instead of reconstructed.
  uniform float uWindFixLocal;

  uniform float uDirtCut;        // how much shorter blades get on dirt (1 = gone)
  uniform float uShadowSampleY;  // height up the blade the shadow kernel sits at
  uniform float uShadowRadius;   // world-space radius of the soft-shadow kernel

  // Shadow coordinates, one per tap, built in the vertex from the blade's real
  // world positions and averaged in the fragment for a soft shadow.
  #ifdef USE_SHADOWMAP
    varying vec4 vGrassShCoord[ GRASS_SHADOW_TAPS ];
  #endif

  // ── Rock trampling ────────────────────────────────────────────────────────
  // Each rock is fed in as a world-space sphere: xyz = centre, w = radius.
  // Blades near one are pressed down and splayed outward, as if the rock had
  // been dropped on them.
  uniform vec4  uRocks[ MAX_ROCKS ];
  uniform int   uRockCount;
  uniform float uRockRadiusMul;  // grows/shrinks the influence disc per rock
  uniform float uRockFalloff;    // world units of soft edge outside the disc
  uniform float uRockFlatten;    // 1 = blades under a rock are pressed flat
  uniform float uRockBend;       // how far the tips splay away from the centre
`;

export const GRASS_BLADE_VERTEX = /* glsl */ `
  #include <begin_vertex>

  // Blade base in world space = the instance matrix's translation column.
  vec2 baseXZ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  vDirt = groundDirt(baseXZ);

  // ── Rock trampling ────────────────────────────────────────────────────────
  // Find the rock that presses on this blade hardest. Blades are small relative
  // to the rocks, so the strongest single influence is a good enough stand-in
  // for the combined one — and it costs one pass over the list.
  float rockInfl = 0.0;
  vec2  rockAway = vec2(1.0, 0.0);
  for (int i = 0; i < MAX_ROCKS; i++) {
    if (i >= uRockCount) break;
    vec4  rock = uRocks[i];
    vec2  d    = baseXZ - rock.xz;
    float dist = length(d);
    float rad  = rock.w * uRockRadiusMul;
    float infl = 1.0 - smoothstep(rad, rad + uRockFalloff, dist);
    if (infl > rockInfl) {
      rockInfl = infl;
      rockAway = dist > 1e-4 ? d / dist : vec2(1.0, 0.0);
    }
  }
  vRockInfl = rockInfl;

  // Grass thins out over dirt instead of stopping at a line, and is pressed down
  // under the rocks. Both are the same operation — a height scale — so they
  // compose into a single factor.
  float shrink = (1.0 - uDirtCut * vDirt) * (1.0 - uRockFlatten * rockInfl);
  transformed.y *= shrink;

  // Everything downstream must use the SHRUNK height, not position.y:
  //   vBH   — the color gradient. On the original height, a blade squashed flat
  //           over dirt would still paint its (green) tip color, speckling the
  //           patch with green flecks.
  //   hMask — the wind mask. On the original height, a squashed blade would still
  //           take the full horizontal wind offset and skate across the dirt as a
  //           flat sliver.
  vBH = position.y * shrink;
  float hMask = vBH * vBH;

  vec3 wPos = (instanceMatrix * vec4(position, 1.0)).xyz;
  vWorldPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;

  float primary = sin(dot(wPos.xz, uWindDir) * uWindFreq + uTime * uWindSpeed);
  float second  = sin(dot(wPos.xz, uWindDir) * uWindFreq * 2.6 + uTime * uWindSpeed * 1.8 + 1.3) * 0.35;
  vec2  perp    = vec2(-uWindDir.y, uWindDir.x);
  float turb    = sin(dot(wPos.xz, perp) * uWindFreq * 1.9 + uTime * uWindSpeed * 0.7 + 2.6) * uWindTurb;
  float swing   = (primary + second + turb) * uWindStrength * hMask;
  float lean    = uWindLean * hMask;

  // Wind is a world-space vector but transformed is in blade-local space, and
  // every blade has a random Y rotation — so local +X points a different way per
  // blade and they would fan out instead of leaning together. Fix: bring the wind
  // into local space by inverting the instance rotation. Normalizing the columns
  // strips the non-uniform scale, leaving a pure rotation whose transpose is its
  // inverse.
  mat3 instRot = mat3(
    normalize(vec3(instanceMatrix[0])),
    normalize(vec3(instanceMatrix[1])),
    normalize(vec3(instanceMatrix[2]))
  );
  // uWindFixLocal = 0 applies the WORLD wind vector as if it were local — every
  // blade then leans along its own random rotation and the field fans out. Kept
  // as a switch because it's the clearest way to show why the transpose is here.
  vec3 windWrong = vec3(uWindDir.x, 0.0, uWindDir.y);
  vec3 windRight = transpose(instRot) * windWrong;
  vec3 windLocal = mix(windWrong, windRight, uWindFixLocal);
  transformed += windLocal * (swing + lean);

  // Splay the tips away from the rock's centre — same world→local trick as the
  // wind. Bending on top of the flattening is what sells the trampling: pressed
  // down AND pushed aside, rather than merely scaled short.
  if (rockInfl > 0.001) {
    vec3 awayLocal = transpose(instRot) * vec3(rockAway.x, 0.0, rockAway.y);
    transformed += awayLocal * (uRockBend * rockInfl * hMask);
  }

  // instRot carries rotation only, so it is safe on a normal without an
  // inverse-transpose.
  vBladeN = normalize(mat3(modelMatrix) * instRot * normal);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Soft per-blade shadow — replaces <worldpos_vertex>.
//
// Three builds vDirectionalShadowCoord from `worldPosition` per-vertex and then
// interpolates it per-fragment: a SINGLE sample per pixel, with an edge only as
// soft as the shadow map's own PCF. Two ways that goes wrong for grass:
//   · per fragment            → a blade straddling a shadow edge is half lit /
//                               half dark, and the boundary cuts a hard straight
//                               line across the field
//   · one sample per blade    → each blade is fully in or out, and it POPS: as a
//     (the old trick)           caster edge sweeps across — trees and their
//                               wind-swayed leaves cast MOVING shadows — the
//                               blade's one sample flips and the blade flickers.
//
// The real cause of the flicker is a HARD shadow edge crossing the grass. So the
// fix is a wide penumbra: sample the shadow map at several points spread out in a
// small horizontal RING around the blade (a manual PCF, wider than the shadow
// map's own), and average them in the fragment. Stacking taps up the blade
// wouldn't help — they'd all sit at nearly the same XZ and a sideways-moving edge
// would still cross them together. Spreading them sideways is what turns a
// snapping edge into one that fades across a blade's width.
//
// So this stage: disables Lambert's own single-sample shadow by shoving the
// world position it reads outside the shadow frustum (where getShadow returns
// "fully lit"), and builds the ring of shadow coordinates the fragment averages.
// ─────────────────────────────────────────────────────────────────────────────
export const GRASS_SHADOW_VERTEX = /* glsl */ `
  // Neutralise Lambert's built-in shadow: the coordinate it derives from this
  // lands outside the frustum → getShadow() → 1.0 (unshadowed).
  #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP )
    vec4 worldPosition = vec4( 1e6, 1e6, 1e6, 1.0 );
  #endif

  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vec3 _shBase = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    vec3 _shTip  = ( modelMatrix * instanceMatrix * vec4( 0.0, 1.0, 0.0, 1.0 ) ).xyz;
    vec3 _shCenter = mix( _shBase, _shTip, uShadowSampleY );

    // Per-blade rotation of the ring, so the kernels don't line up into a visible
    // pattern across the field.
    float _rot = fract( sin( dot( _shBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831853;

    // Ring of taps in world XZ, radius uShadowRadius: a soft penumbra that width.
    for ( int _k = 0; _k < GRASS_SHADOW_TAPS; _k++ ) {
      float _a   = _rot + 6.2831853 * ( float( _k ) + 0.5 ) / float( GRASS_SHADOW_TAPS );
      vec2  _off = vec2( cos( _a ), sin( _a ) ) * uShadowRadius;
      vGrassShCoord[ _k ] = directionalShadowMatrix[ 0 ] * vec4( _shCenter + vec3( _off.x, 0.0, _off.y ), 1.0 );
    }
  #endif
`;
