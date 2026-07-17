import * as THREE from "three";
import type { BladeUniforms, GroundUniforms } from "../uniforms";
import { GROUND_MASK_UNIFORMS, GROUND_MASK_GLSL } from "../shaders/groundMask";
import { MAX_SHADOW_TAPS } from "../shaders/grassBlade";

// ─────────────────────────────────────────────────────────────────────────────
// Ground material — the surface the blades grow out of.
//
// Three things have to line up with the blades, and each one is a bug if it
// doesn't:
//
//  1. COLOR. The ground takes the blades' bottom color (uTintFloor), so the
//     bases have nothing to band against.
//
//  2. NORMAL. The blades force their shading normal to +Y (see bladeMaterial),
//     so the ground must too — otherwise the identical diffuse color comes out
//     at a different NdotL and the ground reads as another shade of green.
//     Meshes exported with a negative scale make this worse: their normals point
//     *down*, and the ground ends up lit from below.
//
//  3. DIRT. Both sample the same groundDirt() mask, so the ground paints earth
//     exactly where the blades thin out into it.
//
//  4. SHADOW. The blades disable Lambert's built-in shadow and apply their own
//     soft, ring-averaged one scaled by uShadowStrength (see bladeMaterial). The
//     ground has to do the SAME, or bare earth ends up with Lambert's full-
//     strength hard shadow while the grass over it barely darkens — the two read
//     as different shadow "levels", most visible where grass thins into dirt.
//
// The dirt texture (variation + grain) is weighted by that same mask: it is
// EARTH texture, so it must not appear under the grass, where the ground has to
// stay exactly the blades' bottom color.
// ─────────────────────────────────────────────────────────────────────────────

export function makeGroundMaterial(
  u: BladeUniforms & GroundUniforms,
  /** Base color of the mesh's original material, used when uTintFloor is 0. */
  baseColor?: THREE.Color,
): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ side: THREE.FrontSide });
  if (baseColor) mat.color.copy(baseColor);

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);

    // ── Vertex: flatten the normal, carry world XZ, build the shadow ring ────
    shader.vertexShader =
      `#define GRASS_SHADOW_TAPS ${MAX_SHADOW_TAPS}
      uniform float uFlatFloorNormal;
      uniform float uShadowRadius;
      varying vec2 vGndXZ;
      #ifdef USE_SHADOWMAP
        varying vec4 vGndShCoord[ GRASS_SHADOW_TAPS ];
      #endif\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <defaultnormal_vertex>",
      `#include <defaultnormal_vertex>
      vec3 _upView = normalize( mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );
      transformedNormal = normalize( mix( transformedNormal, _upView, uFlatFloorNormal ) );`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vGndXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;`,
    );
    // Same soft-shadow scheme as the blades: disable Lambert's own shadow (its
    // world position lands outside the frustum → getShadow → fully lit) and build
    // a ring of shadow coords around this surface point, at radius uShadowRadius,
    // for the fragment to average.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP )
        vec4 worldPosition = vec4( 1e6, 1e6, 1e6, 1.0 );
      #endif
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        vec3 _gwp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        for ( int _k = 0; _k < GRASS_SHADOW_TAPS; _k++ ) {
          float _a   = 6.2831853 * ( float( _k ) + 0.5 ) / float( GRASS_SHADOW_TAPS );
          vec2  _off = vec2( cos( _a ), sin( _a ) ) * uShadowRadius;
          vGndShCoord[ _k ] = directionalShadowMatrix[ 0 ] * vec4( _gwp + vec3( _off.x, 0.0, _off.y ), 1.0 );
        }
      #endif`,
    );

    // ── Fragment ─────────────────────────────────────────────────────────────
    shader.fragmentShader =
      `#define GRASS_SHADOW_TAPS ${MAX_SHADOW_TAPS}
      varying vec2  vGndXZ;
      uniform vec3  uGrassBottom;
      uniform float uBrightness;
      uniform float uTintFloor;
      uniform vec3  uPatchLush;
      uniform vec3  uPatchDry;
      uniform float uPatchStrength;
      uniform float uPatchScale;
      uniform float uPatchBias;
      uniform vec3  uGndVarColor;
      uniform float uGndVarScale;
      uniform float uGndVarStrength;
      uniform float uGndGrainScale;
      uniform float uGndGrainStrength;
      uniform float uGndReliefScale;
      uniform float uGndReliefStrength;
      uniform int   uShadowSamples;
      uniform float uShadowStrength;
      #ifdef USE_SHADOWMAP
        varying vec4 vGndShCoord[ GRASS_SHADOW_TAPS ];
      #endif\n` +
      GROUND_MASK_UNIFORMS +
      GROUND_MASK_GLSL +
      shader.fragmentShader;

    // Average the shadow ring and darken by uShadowStrength — the exact same
    // treatment the blades get, so ground and grass share one shadow level.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        {
          DirectionalLightShadow _dls = directionalLightShadows[ 0 ];
          float _sSum = 0.0;
          int   _sN   = 0;
          for ( int _k = 0; _k < GRASS_SHADOW_TAPS; _k++ ) {
            if ( _k >= uShadowSamples ) break;
            _sSum += getShadow(
              directionalShadowMap[ 0 ],
              _dls.shadowMapSize,
              _dls.shadowIntensity,
              _dls.shadowBias,
              _dls.shadowRadius,
              vGndShCoord[ _k ]
            );
            _sN++;
          }
          float _gShadow = _sSum / float( max( _sN, 1 ) );
          gl_FragColor.rgb *= ( 1.0 - uShadowStrength * ( 1.0 - _gShadow ) );
        }
      #endif`,
    );

    // Fake relief: tilt the shading normal by the SLOPE of a noise field (central
    // differences in world XZ). The geometry stays flat, but NdotL now varies, so
    // the ground reads as soft mounds and hollows instead of a painted plane.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      `#include <normal_fragment_begin>
      if ( uGndReliefStrength > 0.001 ) {
        vec2  _rp = vGndXZ * uGndReliefScale;
        float _e  = 0.5;
        float _hL = _gmFbm( _rp - vec2( _e, 0.0 ) );
        float _hR = _gmFbm( _rp + vec2( _e, 0.0 ) );
        float _hD = _gmFbm( _rp - vec2( 0.0, _e ) );
        float _hU = _gmFbm( _rp + vec2( 0.0, _e ) );
        vec3  _wn = normalize( vec3( -( _hR - _hL ), 1.0, -( _hU - _hD ) )
                             * vec3( uGndReliefStrength, 1.0, uGndReliefStrength ) );
        normal = normalize( mat3( viewMatrix ) * _wn );
      }`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `float _dirt = groundDirt( vGndXZ );

      // Environmental patches — the SAME lush→dry gradient the blades apply, at
      // the same world position, so the ground under a dry patch drifts to the
      // same colour as the blade bases growing out of it. Without this the tinted
      // ground stays plain green while the blades go dry, and the bases stop
      // melting into the ground.
      float _pt = pow( clamp( _gmFbm( vGndXZ * uPatchScale ), 0.0, 1.0 ), uPatchBias );
      vec3 _grassTint = mix( uGrassBottom, mix( uPatchLush, uPatchDry, _pt ), uPatchStrength );

      vec3 _gndCol = mix( diffuse, _grassTint * uBrightness, uTintFloor );
      _gndCol = mix( _gndCol, uDirtColor * uBrightness, _dirt );

      // Two scales of tonal break-up toward the same variation color: a slow one
      // for large patches of a different shade, and a fine one for close-up
      // grain (without it the ground goes flat and plasticky as the camera nears).
      //
      // The noise is centred on 0.5, so (n - 0.5) is SIGNED: it pulls the ground
      // toward the variation color in some places and away from it in others,
      // which keeps the average tone put. A plain mix toward the variation color
      // would just darken the whole ground as the strength went up.
      float _var   = _gmFbm( vGndXZ * uGndVarScale )   - 0.5;
      float _grain = _gmFbm( vGndXZ * uGndGrainScale ) - 0.5;
      vec3  _varCol = uGndVarColor * uBrightness;
      _gndCol += ( _varCol - _gndCol ) * _var   * uGndVarStrength   * _dirt;
      _gndCol += ( _varCol - _gndCol ) * _grain * uGndGrainStrength * _dirt;
      _gndCol = max( _gndCol, vec3( 0.0 ) );

      vec4 diffuseColor = vec4( _gndCol, opacity );`,
    );
  };

  return mat;
}
