import * as THREE from "three";
import type { PineLeafUniforms } from "../uniforms";

// ─────────────────────────────────────────────────────────────────────────────
// Pine-needle material — a stylized repaint over the GLB's own leaf texture.
//
// Foliage in scanned/photogrammetry assets is usually a photographic atlas on
// alpha-masked quads. The photo is what makes it read as realistic; the alpha is
// what gives it its shape. So we keep the map bound and overwrite ONLY .rgb,
// right after <map_fragment> — `diffuseColor.a` still comes straight from the
// texture, which matters twice over: alphaTest keeps cutting the needle
// silhouette, and Three derives the SHADOW silhouette from map + alphaTest too.
// Drop the texture and the canopy would cast rectangles.
// ─────────────────────────────────────────────────────────────────────────────

export function makePineLeafMaterial(
  src: THREE.MeshStandardMaterial,
  mesh: THREE.Mesh,
  u: PineLeafUniforms,
): THREE.MeshLambertMaterial {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!;

  const mat = new THREE.MeshLambertMaterial({
    map: src.map,
    alphaTest: src.alphaTest > 0 ? src.alphaTest : 0.6,
    transparent: false,
    side: THREE.DoubleSide,
  });

  // Per-mesh, so the gradient spans each canopy on its own instead of the whole
  // scene's height range.
  const uLeafYMin: THREE.IUniform<number> = { value: bb.min.y };
  const uLeafYMax: THREE.IUniform<number> = { value: bb.max.y };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uLeafYMin, uLeafYMax });

    shader.vertexShader =
      `varying vec3 vLeafLocal;\nvarying vec3 vLeafWorld;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
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
