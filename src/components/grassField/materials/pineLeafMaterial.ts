import * as THREE from "three";
import type { BladeUniforms, PineLeafUniforms } from "../uniforms";
import { PINE_WIND_UNIFORMS, PINE_WIND_VERTEX } from "../shaders/pineLeaf";

// ─────────────────────────────────────────────────────────────────────────────
// Pine-needle materials — a stylized repaint of the GLB's foliage, plus wind.
//
// COLOR. Foliage in scanned assets is usually a photographic atlas on alpha-
// masked quads: the photo is what makes it read as realistic, the alpha is what
// gives it its shape. So the map stays bound and only .rgb is overwritten, right
// after <map_fragment> — `diffuseColor.a` still comes straight from the texture,
// which matters twice: alphaTest keeps cutting the needle silhouette, and Three
// derives the SHADOW silhouette from map + alphaTest too. Drop the texture and
// the canopy casts rectangles.
//
// WIND. Same story as the flowers: Three renders the shadow map with its own
// depth material, which knows nothing about our vertex displacement. It would
// keep the needle-shaped shadow (map + alphaTest are copied over) but the shadow
// would sit perfectly still while the canopy swayed out of it. Hence
// makePineLeafDepthMaterial, which repeats the exact same wind.
//
// The wind uniforms come from the field's shared bag, so the trees and the grass
// answer to one gust.
// ─────────────────────────────────────────────────────────────────────────────

type LeafWindUniforms = PineLeafUniforms &
  Pick<BladeUniforms, "uTime" | "uWindDir" | "uWindSpeed" | "uWindFreq">;

/** The canopy's own vertical extent — the wind's height mask is relative to it,
 *  so branches near the trunk stay put while the outer foliage moves. */
function canopyBounds(mesh: THREE.Mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!;
  return {
    uLeafYMin: { value: bb.min.y } as THREE.IUniform<number>,
    uLeafYMax: { value: bb.max.y } as THREE.IUniform<number>,
  };
}

export function makePineLeafMaterial(
  src: THREE.MeshStandardMaterial,
  mesh: THREE.Mesh,
  u: LeafWindUniforms,
): THREE.MeshLambertMaterial {
  const bounds = canopyBounds(mesh);

  const mat = new THREE.MeshLambertMaterial({
    map: src.map,
    alphaTest: src.alphaTest > 0 ? src.alphaTest : 0.6,
    transparent: false,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, bounds);

    shader.vertexShader =
      PINE_WIND_UNIFORMS +
      `varying vec3 vLeafLocal;\nvarying vec3 vLeafWorld;\n` +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      PINE_WIND_VERTEX +
        `
      vLeafLocal = position;
      vLeafWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;`,
    );

    shader.fragmentShader =
      `varying vec3  vLeafLocal;
      varying vec3  vLeafWorld;
      uniform vec3  uLeafBottom;
      uniform vec3  uLeafTop;
      uniform float uLeafBrightness;
      uniform float uLeafGradPower;
      uniform vec3  uLeafVarColor;
      uniform float uLeafVarStrength;
      uniform float uLeafVarScale;
      uniform float uLeafYMin;
      uniform float uLeafYMax;

      float _lfHash(vec3 p) {
        p = fract( p * vec3( 127.1, 311.7, 74.7 ) );
        p += dot( p, p.yzx + 19.19 );
        return fract( ( p.x + p.y ) * p.z );
      }
      float _lfNoise(vec3 p) {
        vec3 i = floor( p );
        vec3 f = fract( p );
        vec3 w = f * f * ( 3.0 - 2.0 * f );
        return mix(
          mix( mix( _lfHash( i ),               _lfHash( i + vec3(1,0,0) ), w.x ),
               mix( _lfHash( i + vec3(0,1,0) ), _lfHash( i + vec3(1,1,0) ), w.x ), w.y ),
          mix( mix( _lfHash( i + vec3(0,0,1) ), _lfHash( i + vec3(1,0,1) ), w.x ),
               mix( _lfHash( i + vec3(0,1,1) ), _lfHash( i + vec3(1,1,1) ), w.x ), w.y ),
          w.z );
      }\n` + shader.fragmentShader;

    // Keep .a (the needle cut-out), repaint .rgb: a vertical gradient across the
    // canopy plus a noise break-up, so it doesn't read as one flat chip of green.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      {
        float _t = clamp( ( vLeafLocal.y - uLeafYMin ) / max( uLeafYMax - uLeafYMin, 0.001 ), 0.0, 1.0 );
        _t = pow( _t, uLeafGradPower );
        vec3 _leaf = mix( uLeafBottom, uLeafTop, _t );
        float _n = _lfNoise( vLeafWorld * uLeafVarScale ) - 0.5;
        _leaf += ( uLeafVarColor - _leaf ) * _n * uLeafVarStrength;
        diffuseColor.rgb = max( _leaf, vec3( 0.0 ) ) * uLeafBrightness;
      }`,
    );
  };

  return mat;
}

/**
 * Depth material for the canopy shadow. Deliberately STATIC — it does NOT replay
 * the wind the visible canopy uses.
 *
 * A swaying canopy casts a shadow with a moving edge, and a moving hard edge
 * flickers as it sweeps across the grass (aliasing in the shadow map that no
 * amount of receiver-side softening fully hides). A tree's cast shadow is a soft,
 * high blob, so the sway is nearly invisible in it anyway — freezing it costs
 * nothing visually and removes the biggest flicker source. It also lets the whole
 * shadow map be frozen (see ShadowController), since every caster is then static.
 *
 * Only `map` + `alphaTest` are kept, which is what gives the shadow its needle
 * silhouette; MeshDepthMaterial handles the alpha cut-out on its own.
 */
export function makePineLeafDepthMaterial(
  src: THREE.MeshStandardMaterial,
): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: src.map,
    alphaTest: src.alphaTest > 0 ? src.alphaTest : 0.6,
    side: THREE.DoubleSide,
  });
}
