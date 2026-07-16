// ─────────────────────────────────────────────────────────────────────────────
// Debug / breakdown GLSL — injected into the blade shader.
//
// This is the "Debug View" dropdown made real: each channel paints one
// intermediate value the shader has ALREADY computed, so the debug view IS the
// production shader with its final colour swapped out — not a parallel material
// that can drift out of sync. Injected in bladeMaterial; driven by uDebugChannel
// (see uniforms.ts, controls.ts) and filmed for the breakdown video.
//
// Kept in its own file so the blade material reads as the real thing, with the
// teaching scaffolding clearly separate and easy to strip.
// ─────────────────────────────────────────────────────────────────────────────

/** Fragment declarations the debug switch needs. `vRockInfl` is a varying that
 *  exists ONLY for the rock-influence channel — it's written in the vertex. */
export const DEBUG_FRAGMENT_UNIFORMS = /* glsl */ `
  varying float vRockInfl;
  uniform int   uDebugChannel;
`;

/**
 * Replaces the blade's final colour with an intermediate value when a channel is
 * selected (0 = off = the real shader). Inject at the very end of the lighting
 * block, where `_shadow` and `_trans` are still in scope.
 */
export const DEBUG_VIEW_FRAGMENT = /* glsl */ `
  if ( uDebugChannel == 1 ) {
    gl_FragColor.rgb = vec3( vBH );                       // height mask
  } else if ( uDebugChannel == 2 ) {
    gl_FragColor.rgb = vec3( vDirt );                     // dirt mask
  } else if ( uDebugChannel == 3 ) {
    gl_FragColor.rgb = vec3( vRockInfl );                 // rock influence
  } else if ( uDebugChannel == 4 ) {
    gl_FragColor.rgb = vec3( _shadow );                   // shadow factor
  } else if ( uDebugChannel == 5 ) {
    gl_FragColor.rgb = _trans;                            // translucency alone
  } else if ( uDebugChannel == 6 ) {
    gl_FragColor.rgb = normalize( vBladeN ) * 0.5 + 0.5;  // true blade normal
  }
`;
