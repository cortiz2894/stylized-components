// ─────────────────────────────────────────────────────────────────────────────
// Sky Presets
//
// Every field except `label` and the feature flags is optional: what a preset
// doesn't define falls back to the Leva control value in SkyDome, so a preset
// only needs to declare what differs from the tweaked defaults.
// ─────────────────────────────────────────────────────────────────────────────

export type SkyMode = "sunrise" | "day" | "sunset" | "night";

export interface AmbientPreset {
  color: string;
  intensity: number;
}

/** Per-preset lighting rig (ambient + directional). */
export interface LightPreset {
  ambientColor: string;
  ambientIntensity: number;
  dirColor: string;
  dirIntensity: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface FilterPreset {
  /** CSS color for a full-screen mix-blend-mode overlay. */
  color: string;
  /** 0 = off, 1 = full tint. */
  opacity: number;
}

export interface ShadowPreset {
  shadowBias?: number;
  shadowNormalBias?: number;
  shadowNear?: number;
  shadowFar?: number;
  shadowCamSize?: number;
  shadowMapSize?: 512 | 1024 | 2048 | 4096;
}

export interface SkyPreset {
  label: string;
  ambient: AmbientPreset;
  filter: FilterPreset;
  light: LightPreset;
  shadow?: ShadowPreset;

  // ── Feature flags ──────────────────────────────────────────────────────────
  starsEnabled: boolean;
  moonEnabled: boolean; // the moon system doubles as the sun disc
  cloudsEnabled: boolean;
  sparklesEnabled?: boolean;
  dustCloudsEnabled?: boolean;
  auroraEnabled?: boolean;
  sideDistortionEnabled?: boolean;

  // ── Stars ──────────────────────────────────────────────────────────────────
  starDensity?: number;
  starSize?: number;
  starBrightness?: number;
  starFloor?: number;

  // ── Sky gradient ───────────────────────────────────────────────────────────
  skyLow?: string;
  skyHigh?: string;
  horizonLine?: number;
  horizonSpread?: number;

  // ── Moon / Sun disc ────────────────────────────────────────────────────────
  moonElev?: number; // degrees
  moonAzim?: number; // degrees
  moonColor?: string;
  moonGlowColor?: string;
  moonGlowFalloff?: number;
  moonGlowIntensity?: number;
  moonSize?: number;
  moonEdgeSoftness?: number;
  moonPhasePos?: number;
  moonPhaseSoftness?: number;
  moonPhaseAngle?: number; // degrees
  moonEmission?: number;
  moonSpotColor?: string;
  moonSpotStrength?: number;

  // ── Aurora ─────────────────────────────────────────────────────────────────
  auroraIntensity?: number;
  auroraColor1?: string;
  auroraColor2?: string;

  // ── Clouds ─────────────────────────────────────────────────────────────────
  cloudSpeed?: number;
  cloudScale?: number;
  cloudDensity?: number;
  cloudSharpness?: number;
  cloudOctaves?: number;
  cloudAmplitude?: number;
  cloudGrain?: number;
  cloudCore?: string;
  cloudEdge?: string;
  cloudRim?: string;
  cloudEdgeWidth?: number;
  cloudRimStrength?: number;
  cloudDarkenFar?: number;
  cloudStretch?: number;
  cloudMorphSpeed?: number;
  cloudOpacity?: number;
  cloudFloor?: number;
  cloudCeiling?: number;
  moonLightRadius?: number;
  moonLightSoftness?: number;

  // ── Scene dressing carried over from the source project ────────────────────
  // Unused by SkyDome itself; kept so the presets stay portable between scenes.
  mountainColor?: string;
  mountainColorTop?: string;
  gradSoftness?: number;
  fogColor?: string;
  fogDensity?: number;
  fogY?: number;
  chunkFogColor?: string;
  seabedColorBottom?: string;
  seabedColorTop?: string;
  seabedFadeDistance?: number;
  seabedFadeStrength?: number;
  waterHorizonColor?: string;
  waterDeepColor?: string;
  waterDeepOpacity?: number;
  waterFadeStrength?: number;
  rainColor?: string;
  rainOpacity?: number;
}

/** Written each frame by a day-cycle controller to cross-fade two presets. */
export interface BlendState {
  /** True only during the transition window. */
  active: boolean;
  /** Smoothstepped 0 → 1 over the transition window. */
  t: number;
  from: SkyPreset;
  to: SkyPreset;
}

export const SKY_PRESETS: Record<SkyMode, SkyPreset> = {
  sunrise: {
    label: "Sunrise",
    ambient: { color: "#fff5b7", intensity: 2 },
    filter: { color: "hsl(220, 70%, 55%)", opacity: 0 },
    light: {
      ambientColor: "#e0ccff",
      ambientIntensity: 2.55,
      dirColor: "#ffffff",
      dirIntensity: 3.0,
      dirX: 10.5,
      dirY: 114.0,
      dirZ: 176.5,
      targetX: 99.5,
      targetY: 23.0,
      targetZ: 200,
    },

    starsEnabled: false,
    moonEnabled: true, // moon system doubles as the sun disc
    cloudsEnabled: true,

    sparklesEnabled: true,
    dustCloudsEnabled: true,

    // Sky
    skyLow: "#fce8a4",
    skyHigh: "#52add1",
    horizonLine: 0.05,
    horizonSpread: 0.2,

    // Sun disc (reusing moon uniforms)
    moonElev: 10,
    moonAzim: 258,
    moonColor: "#fffffd",
    moonGlowColor: "#ff8026",
    moonSize: 0.015,
    moonEdgeSoftness: 0.04,
    moonPhasePos: 2, // fully lit — no shadow
    moonPhaseSoftness: 0.45,
    moonPhaseAngle: 150,
    moonEmission: 1.4,
    moonSpotColor: "#69c2f6",
    moonSpotStrength: 0, // no spots on the sun
    moonGlowFalloff: 53,
    // Daytime clouds
    cloudDensity: 0.36,
    // cloudScale: 15.5,
    cloudScale: 8.5,
    cloudSharpness: 0.1,
    // cloudFloor: 0,
    cloudAmplitude: 0.74,
    cloudGrain: 0.13,
    // cloudCore: "#f2f2f2",
    // cloudEdge: "#9ecef8",
    // cloudRim: "#f2f2f2",
    cloudCore: "#aab2ba",
    cloudEdge: "#faf3d0",
    cloudRim: "#e5a715",
    cloudOpacity: 0.45,

    cloudEdgeWidth: 0.11,
    cloudRimStrength: 4.5,
    moonLightRadius: 0.05,
    moonLightSoftness: 0.75,
    cloudDarkenFar: 1,
    cloudFloor: -0.03,
    mountainColor: "#88aebe", //23c2c8
    mountainColorTop: "#ded0ba",
    gradSoftness: 0.8,
    fogColor: "#c1c1c1",
    fogDensity: 0.4,
    chunkFogColor: "#4568e7",
    waterHorizonColor: "#4568e7",
    waterDeepOpacity: 0.7,

    seabedColorBottom: "#23c2c8",
    seabedColorTop: "#177096",
  },
  day: {
    label: "Day",
    ambient: { color: "#fff5b7", intensity: 2 },
    filter: { color: "hsl(220, 70%, 55%)", opacity: 0 },
    light: {
      ambientColor: "#f5e7c3",
      ambientIntensity: 2.0,
      dirColor: "#ffffff",
      dirIntensity: 3.0,
      dirX: 10.5,
      dirY: 114.0,
      dirZ: 176.0,
      targetX: 40.5,
      targetY: 23.0,
      targetZ: 200,
    },
    starsEnabled: false,
    moonEnabled: true, // moon system doubles as the sun disc
    cloudsEnabled: true,
    moonElev: 10,
    moonAzim: 258,
    moonGlowIntensity: 0.45,
    sparklesEnabled: true,
    dustCloudsEnabled: true,

    // Sky
    // Title Screen
    // skyLow: "#2494e5",
    // skyHigh: "#0053ff",
    skyLow: "#4aa7e2",
    skyHigh: "#8ecef2",
    horizonLine: 0.05,
    horizonSpread: 0.15,

    // Sun disc (reusing moon uniforms)
    moonColor: "#fbfcd6",
    moonGlowColor: "#34a2ef",
    moonSize: 0.015,
    moonEdgeSoftness: 0.04,
    moonPhasePos: 2, // fully lit — no shadow
    moonPhaseSoftness: 0.45,
    moonPhaseAngle: 150,
    moonEmission: 1.4,
    moonSpotColor: "#69c2f6",
    moonSpotStrength: 0, // no spots on the sun
    moonGlowFalloff: 53,
    // Daytime clouds
    cloudDensity: 0.36,
    // cloudScale: 15.5,

    // cloudDensity: 0.43,
    cloudScale: 8.5,
    cloudSharpness: 0.05,
    cloudAmplitude: 0.63,
    cloudOctaves: 7,
    cloudGrain: 0.13,
    cloudCore: "#dcdcdc",
    cloudEdge: "#ffffff",
    cloudRim: "#d2d2d2",
    cloudOpacity: 0.4,

    cloudEdgeWidth: 0.13,
    cloudRimStrength: 0.2,
    moonLightRadius: 0.98,
    moonLightSoftness: 0.17,

    cloudDarkenFar: 1,
    cloudFloor: -0.03,
    // mountainColor: "#4584de",
    // mountainColorTop: "#4458eb",
    mountainColor: "#518cb4",
    mountainColorTop: "#518cb4",
    gradSoftness: 0.65,
    fogColor: "#518cb4",
    fogDensity: 0.4,
    chunkFogColor: "#518cb4",
    // waterHorizonColor: "#4568e7",
    waterHorizonColor: "#4aa7e2",
    waterDeepOpacity: 0.7,

    seabedColorBottom: "#23c2c8",
    seabedColorTop: "#177096",
  },

  sunset: {
    label: "Sunset",
    ambient: { color: "#e8924a", intensity: 0.65 },
    filter: { color: "hsl(22, 80%, 58%)", opacity: 0.2 },
    light: {
      ambientColor: "#ffdbbe",
      ambientIntensity: 1.2,
      dirColor: "#ff9568",
      dirIntensity: 2.3,

      dirX: -121.0,
      dirY: 84.5,

      dirZ: 108.0,
      targetX: 172.5,
      targetY: 32.0,
      targetZ: 130.5,
    },

    starsEnabled: true,
    moonEnabled: true, // sun disc
    cloudsEnabled: true,

    sparklesEnabled: false,
    dustCloudsEnabled: false,

    // Sky
    skyLow: "#ffd6a6",
    skyHigh: "#be779d",
    horizonLine: -0.02,
    horizonSpread: 1,

    // Sun disc
    moonElev: 10,
    moonAzim: 258,
    moonColor: "#fff8dc",
    moonGlowColor: "#c48600",
    moonSize: 0.015,
    moonGlowIntensity: 0.1,
    moonGlowFalloff: 0,
    moonEdgeSoftness: 0.11,
    moonPhasePos: 2,
    moonPhaseSoftness: 1.3,
    moonPhaseAngle: 150,
    moonEmission: 0.33,
    moonSpotStrength: 0,

    // Clouds
    cloudDensity: 0.36,
    // cloudScale: 15.5,
    cloudScale: 8.5,
    cloudSharpness: 0.1,
    cloudAmplitude: 0.74,
    cloudGrain: 0.13,
    cloudOpacity: 0.55,
    // Mountains
    cloudCore: "#584a75",
    cloudEdge: "#d86c68",
    cloudRim: "#ffeb89",
    cloudRimStrength: 0.5,
    moonLightRadius: 0.14,
    moonLightSoftness: 0.99,
    cloudDarkenFar: 0.9,
    cloudFloor: -0.04,
    mountainColor: "#6e2a2d",
    mountainColorTop: "#a84050",
    seabedColorBottom: "#06314f",
    seabedColorTop: "#1a707a",
    seabedFadeDistance: 210,
    seabedFadeStrength: 3.8,
    waterDeepOpacity: 0.7,
    fogColor: "#ffa99e",
    fogDensity: 0.2,
    fogY: -11,
    // Rain
    rainColor: "#e8b89a",
    rainOpacity: 0.7,
    // Chunk
    chunkFogColor: "#983a37",
    waterHorizonColor: "#983a37",
    shadow: {
      shadowBias: -0.0027,
      // shadowFar: 1250,
    },
  },
  night: {
    label: "Night",
    ambient: { color: "#314c9d", intensity: 2.25 },
    filter: { color: "hsl(220, 70%, 55%)", opacity: 0.18 },
    light: {
      ambientColor: "#2f4b9d",
      ambientIntensity: 3.1,
      dirColor: "#bcd5ff",
      dirIntensity: 2,
      dirX: -121.0,
      dirY: 70.0,
      dirZ: 81.5,
      targetX: 91.5,
      targetY: 19.5,
      targetZ: 130.5,
    },
    starsEnabled: true,
    moonEnabled: true,
    cloudsEnabled: true,
    skyLow: "#093286",
    skyHigh: "#020238",
    horizonLine: 0.02,
    sparklesEnabled: false,
    horizonSpread: 0.1,
    dustCloudsEnabled: false,
    // Clouds
    // cloudScale: 15.5,
    cloudScale: 8.5,
    cloudSharpness: 0.1,
    cloudAmplitude: 0.74,
    cloudGrain: 0.13,
    cloudDensity: 0.36,
    cloudOpacity: 0.35,
    cloudCore: "#4392e8",
    cloudEdge: "#4392e8",
    cloudRim: "#f2f2f2",
    cloudEdgeWidth: 0.05,
    cloudRimStrength: 0.1,

    moonElev: 10,
    moonAzim: 258,
    // moonEmission: 0.1,
    moonSpotStrength: 0.9,
    moonPhasePos: 0.09999999999999998,
    moonPhaseSoftness: 1.9,
    moonEmission: 2,
    moonGlowFalloff: 80,
    moonGlowColor: "#075fc1",
    moonColor: "#d7ebff",
    moonEdgeSoftness: 0.08,
    // Mountains
    mountainColorTop: "#000c2e",
    mountainColor: "#14316c",
    seabedColorBottom: "#03ad71",
    seabedColorTop: "#00437f",

    seabedFadeDistance: 210,
    seabedFadeStrength: 3.8,
    waterDeepOpacity: 1,
    // Rain
    rainColor: "#6a9ec8",
    rainOpacity: 0.5,
    chunkFogColor: "#091f51",
    waterHorizonColor: "#091f51",
    waterDeepColor: "#379ea0",
    waterFadeStrength: 0.6,
    // Shadow overrides for night — moon is low, extend far plane to reduce cut-off.
    shadow: {
      shadowBias: -0.0015,
      shadowFar: 1250,
    },
    // All sky/moon/cloud values left undefined → Leva controls apply
  },
};
