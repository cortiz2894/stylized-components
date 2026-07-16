import * as THREE from "three";
import type { BladeUniforms } from "../uniforms";
import { GROUND_MASK_UNIFORMS, GROUND_MASK_GLSL } from "../shaders/groundMask";
import {
  MAX_ROCKS,
  MAX_SHADOW_TAPS,
  GRASS_BLADE_UNIFORMS,
  GRASS_BLADE_VERTEX,
  GRASS_SHADOW_VERTEX,
} from "../shaders/grassBlade";
import { DEBUG_FRAGMENT_UNIFORMS, DEBUG_VIEW_FRAGMENT } from "../shaders/debug";

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

/** Half-width of the blade at normalized height t. Tapers to a point at the tip.
 *  The exponent is what gives the blade its slightly concave silhouette instead
 *  of a straight-sided triangle. */
function bladeHalfWidth(t: number): number {
  return 0.5 * Math.pow(1 - t, 1.2);
}

/**
 * Blade geometry — unit size (base width = 1, height = 1), flat in XY. The
 * instance matrix is what scales it to a real blade (roughly 0.06 × 0.25, i.e.
 * far more slender than the unit shape suggests).
 *
 * With `segments = 3` (the default):
 *
 *    v6  ← tip   (y = 1.00)
 *   v4-v5        (y = 0.66)
 *   v2-v3        (y = 0.33)
 *   v0-v1 ← base (y = 0.00)
 *
 * SEGMENTS is a bend-quality dial, and the only one that costs vertices. Wind is
 * applied per-vertex against a squared height mask, so a blade doesn't bend along
 * a curve — it bends along a POLYLINE with one joint per segment. Three segments
 * is enough at low wind; crank the wind up and the elbows start to show, and more
 * segments buy a smoother arc.
 *
 * Note the topology caps what's reachable: a tapered strip has
 * `2 · segments − 1` triangles, so the triangle count is always odd —
 * 5, 7, 9, 11 — never 6.
 */
export function makeBladeGeometry(segments = 3): THREE.BufferGeometry {
  const seg = Math.max(1, Math.round(segments));

  // Two vertices per row, plus a single vertex at the tip.
  const positions = new Float32Array((seg * 2 + 1) * 3);
  for (let i = 0; i < seg; i++) {
    const t = i / seg;
    const w = bladeHalfWidth(t);
    positions[i * 6 + 0] = -w;
    positions[i * 6 + 1] = t;
    positions[i * 6 + 3] = w;
    positions[i * 6 + 4] = t;
  }
  positions[seg * 6 + 1] = 1; // tip, at x = 0

  // Quad per segment (two triangles), capped by one triangle at the tip.
  const indices: number[] = [];
  for (let i = 0; i < seg - 1; i++) {
    const l = i * 2;
    const r = l + 1;
    const nl = l + 2;
    const nr = l + 3;
    indices.push(l, nl, r, r, nl, nr);
  }
  const lastL = (seg - 1) * 2;
  indices.push(lastL, seg * 2, lastL + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
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
      #define GRASS_SHADOW_TAPS ${MAX_SHADOW_TAPS}
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
      `#define GRASS_SHADOW_TAPS ${MAX_SHADOW_TAPS}
      varying float vBH;
      varying vec3  vWorldPos;
      varying vec3  vBladeN;
      varying float vDirt;
      ${DEBUG_FRAGMENT_UNIFORMS}
      uniform vec3  uGrassBottom;
      uniform vec3  uGrassTop;
      uniform float uBrightness;
      uniform float uGradStart;
      uniform float uGradEnd;
      uniform float uGradPower;
      uniform vec3  uDirtColor;
      uniform float uDirtBlend;
      uniform int   uShadowSamples;
      uniform float uShadowStrength;
      uniform vec3  uSunDir;
      uniform vec3  uSunColor;
      uniform vec3  uTransColor;
      uniform float uTransStrength;
      uniform float uTransPower;
      uniform float uTransTip;
      uniform float uTransShadow;
      #ifdef USE_SHADOWMAP
        varying vec4 vGrassShCoord[ GRASS_SHADOW_TAPS ];
      #endif\n` + shader.fragmentShader;

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

    // ── Shadow + translucency ────────────────────────────────────────────────
    // The soft shadow: average the blade's taps (built in GRASS_SHADOW_VERTEX).
    // Lambert's own shadow was disabled there, so this is the only shadow applied
    // — as a multiply on the whole colour, which reads as a uniformly darker
    // green rather than a hard cut. uShadowStrength is how dark it gets.
    //
    // Translucency is the additive back-scatter lobe, applied AFTER: brightest
    // when the viewer looks INTO the sun through the blade (V ≈ -L), i.e. backlit
    // grass. Two modulators — tips transmit more (thinner), and a blade edge-on
    // to the sun transmits more than one facing it. Gated by the same shadow, so
    // the glow never leaks into shadowed grass.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
      {
        float _shadow = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
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
              vGrassShCoord[ _k ]
            );
            _sN++;
          }
          _shadow = _sSum / float( max( _sN, 1 ) );
        #endif

        // Darken the lit blade toward the shadow.
        gl_FragColor.rgb *= ( 1.0 - uShadowStrength * ( 1.0 - _shadow ) );

        vec3  _L    = normalize( uSunDir );
        vec3  _V    = normalize( cameraPosition - vWorldPos );
        float _back = pow( max( dot( _V, -_L ), 0.0 ), uTransPower );
        float _thin = mix( 1.0, vBH, uTransTip );
        float _edge = 1.0 - abs( dot( normalize( vBladeN ), _L ) );
        float _sh   = mix( 1.0, _shadow, uTransShadow );

        vec3 _trans = uTransColor * uSunColor * uTransStrength
                    * _back * _thin * _edge * _sh;

        gl_FragColor.rgb += _trans;

        // Breakdown / debug views (0 = off = production). See shaders/debug.ts.
        ${DEBUG_VIEW_FRAGMENT}
      }`,
    );
  };

  // No customProgramCacheKey: every blade material injects identical GLSL, so
  // they must SHARE one compiled program. A per-instance key would compile a
  // separate program per surface for no benefit — the per-field values ride on
  // uniforms, which are uploaded per material even on a shared program.
  return mat;
}
