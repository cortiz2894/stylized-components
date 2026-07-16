// ─────────────────────────────────────────────────────────────────────────────
// Pine-needle GLSL.
//
// The canopies use the SAME wind as the grass — they read the field's shared
// uWindDir / uTime / uWindSpeed / uWindFreq, so a gust moves the trees and the
// blades under them together instead of two things drifting on their own clocks.
// Only the amplitude and the flutter are leaf-specific.
//
// As with the flowers, this snippet is shared by the visible material AND the
// depth material used for shadow casting: if the shadow pass skipped the wind,
// each tree's shadow would stand still while its canopy swayed out of it.
// ─────────────────────────────────────────────────────────────────────────────

export const PINE_WIND_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uWindSpeed;
  uniform float uWindFreq;
  uniform vec2  uWindDir;
  uniform float uLeafWindStrength;  // 0 = still
  uniform float uLeafFlutterAmp;    // fast, small-scale shimmer on top of the sway
  uniform float uLeafFlutterSpeed;
  uniform float uLeafDip;           // pendulum: the canopy dips as it swings out
  uniform float uLeafYMin;
  uniform float uLeafYMax;
`;

export const PINE_WIND_VERTEX = /* glsl */ `
  #include <begin_vertex>

  // Height mask over the canopy's own bounding box, squared: the branches near
  // the trunk barely move, the outer/upper foliage moves most. Without it the
  // whole canopy would slide sideways as a rigid block and detach from the trunk.
  float _pnT    = clamp( ( position.y - uLeafYMin ) / max( uLeafYMax - uLeafYMin, 0.001 ), 0.0, 1.0 );
  float _pnMask = _pnT * _pnT;

  vec3 _pnWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;

  // Wind is a world-space vector but transformed is mesh-local, and the trees are
  // rotated — so bring it into local space by inverting the model rotation.
  // Normalizing the columns strips the scale, leaving a pure rotation whose
  // transpose is its inverse (same trick as the blades).
  mat3 _pnRot = mat3(
    normalize( vec3( modelMatrix[0] ) ),
    normalize( vec3( modelMatrix[1] ) ),
    normalize( vec3( modelMatrix[2] ) )
  );
  vec3 _pnWindLocal = transpose( _pnRot ) * vec3( uWindDir.x, 0.0, uWindDir.y );

  // Slow sway, phase-shifted by world position so neighbouring trees are never in
  // lockstep, plus a fast low-amplitude flutter for the leaves themselves.
  float _pnSway    = sin( dot( _pnWorld.xz, uWindDir ) * uWindFreq + uTime * uWindSpeed );
  float _pnFlutter = sin( uTime * uWindSpeed * uLeafFlutterSpeed + _pnWorld.y * 2.3 + _pnWorld.x )
                   * uLeafFlutterAmp;
  float _pnWave    = _pnSway + _pnFlutter;

  transformed += _pnWindLocal * ( _pnWave * uLeafWindStrength * _pnMask );
  // Pendulum arc: a branch swinging out also drops a little, instead of sliding
  // along a flat line.
  transformed.y -= abs( _pnWave ) * uLeafWindStrength * _pnMask * uLeafDip;
`;
