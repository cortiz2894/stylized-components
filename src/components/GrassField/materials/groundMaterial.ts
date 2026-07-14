import * as THREE from "three";
import type { BladeUniforms, GroundUniforms } from "../uniforms";
import { GROUND_MASK_UNIFORMS, GROUND_MASK_GLSL } from "../shaders/groundMask";

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

    // ── Vertex: flatten the normal, carry world XZ for the mask ──────────────
    shader.vertexShader =
      `uniform float uFlatFloorNormal;\nvarying vec2 vGndXZ;\n` +
      shader.vertexShader;
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

    // ── Fragment ─────────────────────────────────────────────────────────────
    shader.fragmentShader =
      `varying vec2  vGndXZ;
      uniform vec3  uGrassBottom;
      uniform float uBrightness;
      uniform float uTintFloor;
      uniform vec3  uGndVarColor;
      uniform float uGndVarScale;
      uniform float uGndVarStrength;
      uniform float uGndGrainScale;
      uniform float uGndGrainStrength;
      uniform float uGndReliefScale;
      uniform float uGndReliefStrength;\n` +
      GROUND_MASK_UNIFORMS +
      GROUND_MASK_GLSL +
      shader.fragmentShader;

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

      vec3 _gndCol = mix( diffuse, uGrassBottom * uBrightness, uTintFloor );
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
