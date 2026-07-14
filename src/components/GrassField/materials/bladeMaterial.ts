import * as THREE from "three";
import type { BladeUniforms } from "../uniforms";
import { GROUND_MASK_UNIFORMS, GROUND_MASK_GLSL } from "../shaders/groundMask";
import {
  MAX_ROCKS,
  GRASS_BLADE_UNIFORMS,
  GRASS_BLADE_VERTEX,
  GRASS_SHADOW_VERTEX,
} from "../shaders/grassBlade";

// ─────────────────────────────────────────────────────────────────────────────
// Blade material.
//
// A MeshLambertMaterial, not a raw ShaderMaterial: Lambert already carries
// Three's shadow-receiving pipeline (shadowmap includes, the light structs), so
// the blades receive shadows with nothing more than receiveShadow = true. All we
// do is override diffuseColor with our gradient and add two effects on top.
//
// One deliberate oddity: the shading normal of EVERY blade is forced to +Y. A
// blade is a flat strip with a random Y rotation, so its true normal would give
// each blade a different NdotL and the field would shimmer. Flattening the normal
// makes the lighting depend only on where a blade stands, not how it is turned.
// Translucency still needs the real facing direction, so the vertex shader passes
// it separately as vBladeN.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blade geometry — unit size (base width = 1, height = 1), flat in XY.
 *
 *    v6  ← tip  (y = 1.00)
 *   v4-v5       (y = 0.66)
 *   v2-v3       (y = 0.33)
 *   v0-v1 ← base (y = 0.00)
 */
export function makeBladeGeometry(): THREE.BufferGeometry {
  // prettier-ignore
  const positions = new Float32Array([
    -0.5,  0.00, 0,   // v0  base-left
     0.5,  0.00, 0,   // v1  base-right
    -0.35, 0.33, 0,   // v2
     0.35, 0.33, 0,   // v3
    -0.15, 0.66, 0,   // v4
     0.15, 0.66, 0,   // v5
     0.00, 1.00, 0,   // v6  tip
  ]);
  // prettier-ignore
  const indices = new Uint16Array([0,2,1, 1,2,3, 2,4,3, 3,4,5, 4,6,5]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

export function makeBladeMaterial(u: BladeUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);

    // ── Vertex ───────────────────────────────────────────────────────────────
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      #define MAX_ROCKS ${MAX_ROCKS}
      ${GROUND_MASK_UNIFORMS}
      ${GROUND_MASK_GLSL}
      ${GRASS_BLADE_UNIFORMS}`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      GRASS_BLADE_VERTEX,
    );
    // One shadow sample per blade instead of per vertex.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      GRASS_SHADOW_VERTEX,
    );
    // Same +Y lighting normal for every blade — see the header.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <defaultnormal_vertex>",
      `#include <defaultnormal_vertex>
      transformedNormal = normalize( mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );`,
    );

    // ── Fragment ─────────────────────────────────────────────────────────────
    shader.fragmentShader =
      `varying float vBH;
      varying vec3  vWorldPos;
      varying vec3  vBladeN;
      varying float vDirt;
      uniform vec3  uGrassBottom;
      uniform vec3  uGrassTop;
      uniform float uBrightness;
      uniform float uGradStart;
      uniform float uGradEnd;
      uniform float uGradPower;
      uniform vec3  uDirtColor;
      uniform float uDirtBlend;
      uniform vec3  uSunDir;
      uniform vec3  uSunColor;
      uniform vec3  uTransColor;
      uniform float uTransStrength;
      uniform float uTransPower;
      uniform float uTransTip;
      uniform float uTransShadow;\n` + shader.fragmentShader;

    // Lambert applies (ambient + directional × NdotL × shadow) on top of
    // diffuseColor, so overriding it here is all the color control we need.
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `float _gT = clamp( ( vBH - uGradStart ) / max( uGradEnd - uGradStart, 0.001 ), 0.0, 1.0 );
      _gT = pow( _gT, uGradPower );
      vec3 _bladeCol = mix( uGrassBottom, uGrassTop, _gT );

      // On dirt, the blade takes the ground color over its WHOLE height — no tip
      // fade. Tinting only the base left the tips reading green against the
      // earth, which is exactly the colour break that gave the leftover blades
      // away. At the patch edges vDirt is fractional, so the tint eases in on
      // its own.
      _bladeCol = mix( _bladeCol, uDirtColor, vDirt * uDirtBlend );

      vec4 diffuseColor = vec4( _bladeCol * uBrightness, opacity );`,
    );

    // ── Translucency ─────────────────────────────────────────────────────────
    // Additive back-scatter lobe, applied AFTER Lambert's lighting: brightest
    // when the viewer looks INTO the sun through the blade (V ≈ -L), i.e.
    // backlit grass. Two modulators:
    //   _thin — tips are thinner than the base, so they transmit more
    //   _edge — a blade seen edge-on to the sun transmits more than one facing
    //           it head-on (which is simply lit, not backlit)
    // Shadowed blades transmit nothing, so the glow never leaks into shadowed
    // patches. Lambert has no getShadowMask() (that chunk belongs to
    // ShadowMaterial), so the shadow factor is sampled straight from the
    // directional shadow map, behind the same guards Three itself uses.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
      {
        vec3  _L    = normalize( uSunDir );
        vec3  _V    = normalize( cameraPosition - vWorldPos );
        float _back = pow( max( dot( _V, -_L ), 0.0 ), uTransPower );
        float _thin = mix( 1.0, vBH, uTransTip );
        float _edge = 1.0 - abs( dot( normalize( vBladeN ), _L ) );

        float _shadow = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          DirectionalLightShadow _dls = directionalLightShadows[ 0 ];
          _shadow = getShadow(
            directionalShadowMap[ 0 ],
            _dls.shadowMapSize,
            _dls.shadowIntensity,
            _dls.shadowBias,
            _dls.shadowRadius,
            vDirectionalShadowCoord[ 0 ]
          );
        #endif
        float _sh = mix( 1.0, _shadow, uTransShadow );

        gl_FragColor.rgb += uTransColor * uSunColor * uTransStrength
                          * _back * _thin * _edge * _sh;
      }`,
    );
  };

  // No customProgramCacheKey: every blade material injects identical GLSL, so
  // they must SHARE one compiled program. A per-instance key would compile a
  // separate program per surface for no benefit — the per-field values ride on
  // uniforms, which are uploaded per material even on a shared program.
  return mat;
}
