import type { SkyPreset } from "@/components/skyDome/constants";

// ─────────────────────────────────────────────────────────────────────────────
// The sky outside the classroom window.
//
// Scene-exclusive, like the valley's and the rainy demo's: SkyDome appends it
// to its own dropdown through `extraPresets`, and nothing global changes.
//
// ── What the reference is ────────────────────────────────────────────────────
// The after-school anime classroom: a dark, violet room and a sunset through
// the glass that is the only real light in it. The interior never gets bright —
// the sun does not light the room, it cuts shapes INTO it: slabs on the floor,
// a stripe across the far wall, beams in the dust. Everything else sits in a
// cool purple dusk.
//
// So the two halves of this preset pull apart on purpose:
//
//   · the sky is saturated and warm, orange at the horizon into violet, with a
//     bank of pink cloud for the window to frame;
//   · the rig is a low, dim, violet ambient against a hot orange key — the
//     ratio is the whole look, and raising the ambient is what makes it read as
//     a lit room instead of as light getting into a dark one.
//
// The disc's position IS the scene's sun bearing: the light, the dust and the
// shafts all read the disc's azimuth back from SkyDome, so moving it in the Sky
// panel moves everything. Only the elevations differ — see the note on the two
// suns in GodRaysSceneContent.
// ─────────────────────────────────────────────────────────────────────────────

export const CLASSROOM_SUNSET: SkyPreset = {
  label: "Classroom Sunset",

  ambient: { color: "#6a4f8a", intensity: 0.8 },

  // The wash GodRaysCanvas lays over the frame. A `color` blend, so it keeps
  // the luminance and pulls the hue toward violet — which is most of what makes
  // the desks' baked browns read as the same dusk as the walls.
  filter: { color: "hsl(268, 45%, 48%)", opacity: 0.14 },

  light: {
    // The seeds for ClassroomLighting's panel. See the header: the ratio of
    // these two is the look.
    ambientColor: "#54447a",
    ambientIntensity: 0.14,
    dirColor: "#ffb06a",
    dirIntensity: 2.2,
    // Unused — the direction comes from the scene's sun panel. Kept so the
    // preset satisfies the type and stays portable.
    dirX: 0,
    dirY: 1,
    dirZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  },

  starsEnabled: false,
  moonEnabled: true, // the moon system doubles as the sun disc
  cloudsEnabled: true,
  sparklesEnabled: false,
  dustCloudsEnabled: false,

  // ── Sky gradient ───────────────────────────────────────────────────────────
  skyLow: "#ffa56e",
  skyHigh: "#5d3f86",
  horizonLine: 0.04,
  horizonSpread: 0.35,
  // Zero: the dome is centred ON the camera, so the elevation the panel shows
  // is the elevation the disc appears at through the window. Any other offset
  // shifts the disc on screen and the window framing has to be re-found.
  domeOffsetY: 0,

  // ── The sun ────────────────────────────────────────────────────────────────
  // Azimuth 53° points at the windows (+X) and a little toward the blackboard
  // (+Z), which from the shot puts the disc about 23° left of centre, framed by
  // the pane between the middle pillar and the next mullion. Elevation 7° is
  // what keeps it UNDER the top of that pane from a seated eye.
  moonElev: 16,
  moonAzim: 56,
  moonColor: "#fff2cf",
  moonGlowColor: "#ffb562",
  moonSize: 0.022,
  moonEdgeSoftness: 0.12,
  moonGlowFalloff: 6,
  moonGlowIntensity: 0.35,
  moonEmission: 0.6,
  moonPhasePos: 2, // fully lit — no terminator on a sun
  moonPhaseSoftness: 1,
  moonPhaseAngle: 150,
  moonSpotStrength: 0, // no maria on a sun
  moonCloudBleed: 0.85,

  // ── Clouds ─────────────────────────────────────────────────────────────────
  // A dense bank with violet undersides and hot rims: the window frames a
  // piece of it, and the rim is what the god-ray pass picks up as "sky bright
  // enough to emit" around the disc.
  cloudDensity: 0.55,
  cloudScale: 8,
  cloudSharpness: 0.14,
  cloudAmplitude: 0.72,
  cloudOctaves: 6,
  cloudGrain: 0.1,
  cloudOpacity: 0.85,
  cloudFloor: -0.13,
  cloudFloorFade: 0.25,
  cloudFloorPow: 1.2,
  cloudCeiling: 1,
  cloudStretch: 0.8,
  cloudSpeed: 0.004,
  cloudMorphSpeed: 0.015,
  cloudCore: "#5b3d73",
  cloudEdge: "#e07a86",
  cloudRim: "#ffd690",
  cloudEdgeWidth: 0.22,
  cloudRimStrength: 0.55,

  // ── Volume light in the cloud ─────────────────────────────────────────────
  cloudLit: "#ffc27e",
  cloudLitStrength: 1.3,
  cloudLightSteps: 3,
  cloudLightDist: 0.3,
  cloudAbsorption: 2,
  cloudLightOct: 2,
  cloudBands: 0,
  cloudDarkenFar: 0.9,
  moonLightRadius: 0.5,
  moonLightSoftness: 0.6,

  fogColor: "#e39a86",
  fogDensity: 0.2,
  fogY: 0,
};

/** Key under which SkyDome registers the sky above. */
export const CLASSROOM_SUNSET_MODE = "classroomSunset";

export const CLASSROOM_SKY_PRESETS: Record<string, SkyPreset> = {
  [CLASSROOM_SUNSET_MODE]: CLASSROOM_SUNSET,
};

/**
 * The camera's far plane. Has to clear SkyDome's radius (900 by default) or
 * the backdrop is clipped away — the room itself is barely 25 units deep.
 */
export const CAMERA_FAR = 3000;
