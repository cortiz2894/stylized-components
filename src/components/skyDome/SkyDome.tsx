"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three";
import {
  SKY_PRESETS,
  type SkyMode,
  type SkyPreset,
  type BlendState,
} from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// SkyDome
//
// Large inverted sphere (BackSide) that always follows the camera.
// Layers rendered back → front inside the shader:
//   1. Sky gradient  (dark horizon → lighter zenith)
//   2. Moon glow     (radial corona behind clouds/stars)
//   3. Stars         (procedural hash-based circular dots)
//   4. Moon disc     (hard circle, partially occluded by clouds)
//   5. FBM clouds    (animated, rim-lit by the moon)
//
// renderOrder: -100 | depthTest: false | depthWrite: false
// → renders first, behind every scene object, never pollutes depth buffer
// ─────────────────────────────────────────────────────────────────────────────

const DOME_RADIUS = 1; // unit sphere — actual size driven by mesh.scale via Leva

// ── Vertex shader ─────────────────────────────────────────────────────────────
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;

  void main() {
    // Local-space position = direction FROM camera (dome follows camera in useFrame)
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── Fragment shader ───────────────────────────────────────────────────────────
const SKY_FRAG = /* glsl */ `
  #define PI 3.14159265358979

  // ── Sky gradient ─────────────────────────────────────────────────────────
  uniform vec3  uSkyLow;
  uniform vec3  uSkyHigh;
  uniform float uHorizonLine;
  uniform float uHorizonSpread;

  // ── Moon ─────────────────────────────────────────────────────────────────
  uniform vec3  uMoonDir;
  uniform vec3  uMoonColor;
  uniform vec3  uMoonGlowColor;
  uniform float uMoonSize;
  uniform float uMoonGlowFalloff;
  uniform float uMoonGlowIntensity;
  // Edge & phase
  uniform float uMoonEdgeSoftness;   // 0 = pixel-hard, 0.5 = blurry
  // Linear phase gradient across the disc's local X axis:
  //   uMoonPhasePos  < -1  → fully lit (terminator off-left)
  //   uMoonPhasePos  = 0   → half moon (terminator at centre)
  //   uMoonPhasePos  > 1   → fully dark (terminator off-right)
  uniform float uMoonPhasePos;       // -1.5 (full) … +1.5 (new)
  uniform float uMoonPhaseSoftness;  // 0.05 = sharp terminator, 1.5 = very gradual
  uniform float uMoonPhaseAngle;     // terminator rotation in radians
  uniform float uMoonEmission;       // additive brightness so the disc isn't flat
  // Surface texture (FBM spots / maria)
  uniform vec3  uMoonSpotColor;
  uniform float uMoonSpotScale;
  uniform float uMoonSpotStrength;   // overall blend factor
  uniform float uMoonSpotThreshold;  // FBM cutoff: higher = fewer/smaller patches
  uniform float uMoonSpotSharpness;  // smoothstep half-width: 0.02=hard, 0.2=soft
  uniform int   uMoonSpotOctaves;

  // ── Side distortion (boss fight) ──────────────────────────────────────────
  // Lens-like warp at the screen sides: the sampled sky direction bends and
  // twists as the view direction goes lateral — wide-angle look where cloud
  // bands streak diagonally at the edges. 0 = off (gated per-preset).
  uniform float uSideWarp;  // vertical bend at the sides
  uniform float uSideTwist; // roll/swirl at the sides (radians at full side)

  // ── Aurora / nebula curtains ──────────────────────────────────────────────
  uniform float uAuroraIntensity; // 0 = off (gated per-preset)
  uniform vec3  uAuroraColor1;    // base color (lower edge)
  uniform vec3  uAuroraColor2;    // tip color (upper edge)
  uniform float uAuroraFloor;     // dir.y where the band starts
  uniform float uAuroraCeil;      // dir.y where the band ends
  uniform float uAuroraScale;     // curtain frequency
  uniform float uAuroraSpeed;     // drift / morph speed
  uniform float uAuroraThresh;    // filament cutoff
  uniform float uAuroraSoft;      // filament softness
  uniform float uAuroraWav;       // domain-warp waviness

  // ── Stars ─────────────────────────────────────────────────────────────────
  uniform float uStarDensity;
  uniform float uStarSize;
  uniform float uStarBrightness;
  uniform float uStarFloor;
  uniform float uStarDriftY;         // Y-axis rotation speed (rad/s), ±
  uniform float uStarDriftZ;         // Z-axis rotation speed (rad/s), ±
  uniform float uStarTwinkleSpeed;   // oscillation frequency
  uniform float uStarTwinkleAmount;  // 0 = no twinkle, 1 = full on/off

  // ── Clouds ────────────────────────────────────────────────────────────────
  uniform float uTime;
  uniform float uCloudMorphSpeed;   // per-octave shape evolution speed
  uniform float uCloudSpeed;
  uniform float uCloudScale;
  uniform float uCloudDensity;
  uniform float uCloudSharpness;
  // Three-zone color model
  uniform vec3  uCloudCore;         // deep interior (darkest)
  uniform vec3  uCloudEdge;         // bright outline / backlit edge
  uniform vec3  uCloudRim;          // moon-facing glow at silhouette
  uniform float uCloudEdgeWidth;    // how quickly interior fades to edge (0..1)
  uniform float uCloudRimStrength;  // additive emission intensity
  uniform float uMoonLightRadius;   // angular radius (radians) of moon's light cone
  uniform float uMoonLightSoftness; // 0 = hard cutoff, 1 = very soft (inner edge → 0)
  uniform float uCloudDarkenFar;    // 0 = fully dark far from moon, 1 = no darkening
  uniform float uCloudStretch;      // horizontal stretch of cloud UV (< 1 = wider, > 1 = taller)
  uniform float uCloudFloor;
  uniform float uCloudCeiling;
  uniform float uCloudOpacity;
  // FBM shape controls
  uniform int   uCloudOctaves;      // 1..8
  uniform float uCloudAmplitude;    // persistence per octave (amplitude decay)
  uniform float uCloudGrain;        // high-freq edge detail (0..0.5)
  uniform float uCloudSkew;         // domain-warp strength (0..3)

  varying vec3 vDir;

  // ── Utilities ─────────────────────────────────────────────────────────────
  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i),                    hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)),   hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // ── 3-D noise for spherical cloud FBM ────────────────────────────────────
  // Sampling directly on the unit-sphere surface (dir) instead of a planar
  // projection (dir.xz / dir.y) eliminates the UV blow-up at the horizon and
  // makes clouds wrap the inside of the dome naturally.

  float hash31(vec3 p) {
    p  = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i),               hash31(i + vec3(1,0,0)), u.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), u.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), u.x), u.y),
      u.z
    );
  }

  // Variable-octave 3D FBM — each octave morphs independently via time offsets.
  float fbmCloud(vec3 p) {
    float v = 0.0, a = 0.5, norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uCloudOctaves) break;
      float fi     = float(i) + 1.0;
      float morphT = uTime * uCloudMorphSpeed * fi;
      v    += a * valueNoise3D(p + vec3(morphT, morphT * 0.63, morphT * 0.37));
      norm += a;
      p     = p * 2.1 + vec3(1.7, 9.2, 5.4);
      a    *= uCloudAmplitude;
    }
    return v / max(norm, 0.001);
  }

  // Static FBM for moon surface detail — no time dependence so the surface
  // stays fixed regardless of how long the game runs.
  float fbmMoon(vec2 p) {
    float v = 0.0, a = 0.5, norm = 0.0;
    for (int i = 0; i < 6; i++) {
      if (i >= uMoonSpotOctaves) break;
      v    += a * valueNoise(p);
      norm += a;
      p     = p * 2.1 + vec2(3.1, 7.4);
      a    *= 0.5;
    }
    return v / max(norm, 0.001);
  }

  // ── Star field ─────────────────────────────────────────────────────────────
  // Fix 1 — Equal-angle UV:  u=az/(2π), v=asin(y)/(2π)
  //          Both axes cover the same angle per UV unit at the equator.
  //          Eliminates the 4× horizontal stretch of the old dir.y mapping.
  //
  // Fix 2 — 3×3 cell sampling + fwidth AA:
  //          Sampling only the current cell causes stars to pop at cell borders
  //          as the camera moves. Checking all 9 neighbors and using the pixel
  //          footprint (fwidth) as the smoothstep edge width makes stars stable
  //          and smooth at sub-pixel sizes.
  //
  // Fix 3 — Drift + Twinkle:
  //          The direction vector is rotated slowly around Y (drift) before
  //          computing UV, so the whole star field scrolls gradually.
  //          Brightness oscillates per-star with a random phase (twinkle).
  float starField(vec3 dir) {
    if (dir.y < uStarFloor - 0.05) return 0.0;

    // Drift Y: slow rotation around world Y-axis (horizontal scroll)
    float aY = uTime * uStarDriftY;
    float cY = cos(aY), sY = sin(aY);
    vec3 d = vec3(
      dir.x * cY + dir.z * sY,
      dir.y,
      -dir.x * sY + dir.z * cY
    );

    // Drift Z: rotation around world Z-axis (roll / diagonal tilt)
    float aZ = uTime * uStarDriftZ;
    float cZ = cos(aZ), sZ = sin(aZ);
    d = vec3(
      d.x * cZ - d.y * sZ,
      d.x * sZ + d.y * cZ,
      d.z
    );

    // Equal-angle spherical UV
    // u: azimuth [0,1] spans 2π rad
    // v: elevation via asin — same angular scale as u at the equator
    float az = atan(d.z, d.x);                           // [-π, π]
    float el = asin(clamp(d.y, -1.0, 1.0));              // [-π/2, π/2]
    float u  = az / (2.0 * PI) + 0.5;                    // [0, 1]
    float v  = el / (2.0 * PI) + 0.5;                    // [0.25, 0.75]

    vec2 uv   = vec2(u, v) * uStarDensity;
    vec2 cell = floor(uv);
    vec2 f    = fract(uv);

    // Pixel footprint in UV space → used for AA edge width.
    // At the atan2 seam (az = ±π) u jumps from ~1 to ~0 across two adjacent
    // pixels, so dFdx(uv.x) spikes to ~density (~300). That makes aa enormous,
    // which causes 1-smoothstep(r, r+aa, dist) ≈ 1 for every star in the 3×3
    // loop, lighting up the entire column as a bright line.
    // Guard: if the footprint is unreasonably large we are on the seam —
    // return 0 immediately. The seam is only 1-2 pixels wide; hiding them is
    // invisible compared to the bright artifact.
    vec2 uvPx = vec2(
      length(vec2(dFdx(uv.x), dFdy(uv.x))),
      length(vec2(dFdx(uv.y), dFdy(uv.y)))
    );
    if (max(uvPx.x, uvPx.y) > 2.0) return 0.0;
    float aa = max(uvPx.x, uvPx.y);

    float result = 0.0;

    // Sample 3×3 neighbors — eliminates border-crossing flicker.
    // nw wraps n.x modulo density to fix the atan2 seam (az = ±π):
    // without the wrap, cells on the left side (n.x = -1) and cells on the
    // right side (n.x = density) look up different hashes despite being
    // spatially adjacent — producing a visible vertical artifact line that
    // worsens as drift moves the star field through the seam over time.
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec2 n          = cell + vec2(float(dx), float(dy));
        vec2 nw         = vec2(mod(n.x, uStarDensity), n.y); // seam-safe wrap
        float brightness = hash21(nw + 0.5);
        float hasstar    = step(0.6, brightness); // ~40% of cells

        vec2  offset = hash22(nw);
        float dist   = length(f - (vec2(float(dx), float(dy)) + offset));
        float r      = uStarSize * (0.3 + 0.7 * brightness);

        // Anti-aliased disc using pixel footprint
        float a = (1.0 - smoothstep(r, r + max(aa, 0.001), dist)) * hasstar;

        // Twinkle: per-star sine oscillation with random phase + speed
        float phase   = hash21(nw + 3.7) * 6.28318;
        float rate    = uStarTwinkleSpeed * (0.6 + 0.8 * hash21(nw + 1.3));
        float twinkle = 1.0 - uStarTwinkleAmount * (0.5 + 0.5 * sin(uTime * rate + phase));
        a *= clamp(twinkle, 0.0, 1.0);

        result = max(result, a);
      }
    }

    result *= smoothstep(uStarFloor, uStarFloor + 0.1, dir.y);
    return result;
  }

  void main() {
    vec3 dir = normalize(vDir);
    // Unwarped copy — the moon/sun disc and its glow must NOT bend with the
    // side distortion; they stay anchored at their true sky position.
    vec3 dirM = dir;

    // ── 0. Side distortion (boss fight) ───────────────────────────────────
    // Work in view space: x/|z| ≈ tan of the horizontal view angle. The
    // sampled direction is twisted (roll) and bent (vertical) quadratically
    // toward the screen sides, then rotated back to world space. Warping the
    // direction itself keeps every layer (gradient, stars, aurora, moon,
    // clouds) coherent under the same lens.
    if (abs(uSideWarp) > 0.001 || abs(uSideTwist) > 0.001) {
      vec3 vd = mat3(viewMatrix) * dir;
      float side = vd.x / max(abs(vd.z), 0.25);
      float s2   = side * side;

      // Swirl: signed quadratic twist — mirrors on left/right
      float tw = side * abs(side) * uSideTwist;
      float cs = cos(tw), sn = sin(tw);
      vd.xy = vec2(cs * vd.x - sn * vd.y, sn * vd.x + cs * vd.y);

      // Vertical bend: horizon curves at the edges
      vd.y += s2 * uSideWarp;

      // Back to world space (rotation inverse = transpose)
      dir = normalize(vd * mat3(viewMatrix));
    }

    // ── 1. Sky gradient ───────────────────────────────────────────────────
    float t     = smoothstep(uHorizonLine - uHorizonSpread, uHorizonLine + uHorizonSpread, dir.y);
    vec3  color = mix(uSkyLow, uSkyHigh, t);

    // ── 2. Moon glow (corona behind clouds & stars) — uses the UNWARPED dir
    float cosA = dot(dirM, normalize(uMoonDir));
    float glow  = pow(max(cosA, 0.0), uMoonGlowFalloff) * uMoonGlowIntensity;
    color += uMoonGlowColor * glow;

    // ── 3. Stars ──────────────────────────────────────────────────────────
    float star = starField(dir);
    color = mix(color, vec3(1.0), star * uStarBrightness);

    // ── 3b. Aurora / nebula curtains (additive, behind moon & clouds) ─────
    if (uAuroraIntensity > 0.001) {
      float aBand = smoothstep(uAuroraFloor, uAuroraFloor + 0.15, dir.y) *
                    smoothstep(uAuroraCeil, uAuroraCeil - 0.25, dir.y);
      if (aBand > 0.0) {
        vec3 ap = dir * uAuroraScale;
        ap.y *= 0.25;                        // stretch noise vertically → curtains
        ap.x += uTime * uAuroraSpeed;
        // Wavy domain warp — slow undulation of the curtains
        ap.xz += (vec2(
          valueNoise3D(ap * 0.5 + vec3(0.0, uTime * uAuroraSpeed * 0.7, 3.1)),
          valueNoise3D(ap * 0.5 + vec3(5.2, uTime * uAuroraSpeed * 0.5, 1.7))
        ) - 0.5) * uAuroraWav;

        float n = valueNoise3D(ap) * 0.65 +
                  valueNoise3D(ap * 2.3 + vec3(7.1, 0.0, 2.9)) * 0.35;
        float curtain = smoothstep(uAuroraThresh - uAuroraSoft,
                                   uAuroraThresh + uAuroraSoft, n);

        // Vertical color ramp inside the band: color1 low → color2 high
        float vt = clamp((dir.y - uAuroraFloor) /
                         max(uAuroraCeil - uAuroraFloor, 0.001), 0.0, 1.0);
        vec3 aCol = mix(uAuroraColor1, uAuroraColor2, vt);
        color += aCol * curtain * aBand * uAuroraIntensity;
      }
    }

    // ── 4. Moon disc — applied BEFORE clouds so cloud mix naturally occludes it
    float moonAngle = acos(clamp(cosA, -1.0, 1.0));

    // Build a local 2-D frame at the moon's sky position so we can project
    // the current fragment direction onto it and work in "moon UV" space.
    vec3 moonFwd   = normalize(uMoonDir);
    vec3 moonBase  = abs(moonFwd.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 moonRight = normalize(cross(moonFwd, moonBase));
    vec3 moonUp    = cross(moonRight, moonFwd);

    // Project the UNWARPED dir onto the frame: the disc ignores side distortion.
    float moonR2D = max(sin(uMoonSize), 0.0001);
    vec2  moonUV  = vec2(dot(dirM, moonRight), dot(dirM, moonUp)) / moonR2D;

    // Disc edge: 0.001 = near-pixel-hard, 0.5 = soft glow
    float edge     = max(uMoonEdgeSoftness, 0.001);
    float moonMask = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, length(moonUV));

    // ── Linear phase gradient ────────────────────────────────────────────
    // Rotate moonUV by uMoonPhaseAngle so the terminator can be tilted.
    // Then project onto the rotated X axis — negative = lit side, positive = dark.
    float cosPA   = cos(uMoonPhaseAngle);
    float sinPA   = sin(uMoonPhaseAngle);
    float projX   = moonUV.x * cosPA - moonUV.y * sinPA;
    float litFactor = 1.0 - smoothstep(
      uMoonPhasePos - uMoonPhaseSoftness,
      uMoonPhasePos + uMoonPhaseSoftness,
      projX
    );

    // ── Surface texture: thresholded FBM blobs (hard lunar maria) ────────
    // FBM is thresholded at uMoonSpotThreshold and sharpened by
    // uMoonSpotSharpness — small values give crisp dark patches like the
    // reference image; larger values give a painterly gradient.
    vec3 moonTexColor = uMoonColor;
    if (moonAngle < uMoonSize * 2.0) {
      float spots     = fbmMoon(moonUV * uMoonSpotScale);
      float spotPatch = smoothstep(
        uMoonSpotThreshold - uMoonSpotSharpness,
        uMoonSpotThreshold + uMoonSpotSharpness,
        spots
      );
      moonTexColor = mix(uMoonColor, uMoonSpotColor, spotPatch * uMoonSpotStrength);
    }

    color = mix(color, moonTexColor, moonMask * litFactor);
    // Additive emission: the lit surface radiates light beyond a flat mix,
    // giving the disc a self-luminous quality without needing post-bloom.
    color += moonTexColor * (moonMask * litFactor) * uMoonEmission;

    // ── 5. FBM clouds ─────────────────────────────────────────────────────
    // Ceiling is handled as a DENSITY falloff (fewer/smaller clouds toward the
    // top) instead of an opacity fade — only a tiny guard band remains here.
    float cloudBand = smoothstep(uCloudFloor, uCloudFloor + 0.1, dir.y) *
                      smoothstep(uCloudCeiling, uCloudCeiling - 0.05, dir.y);

    if (cloudBand > 0.0) {
      // Spherical cloud sampling: dir IS the unit-sphere surface point.
      // No planar projection → no UV blowup at the horizon, clouds wrap
      // the inside of the dome with consistent density and curvature.
      vec3 cloudP  = dir * uCloudScale;
      cloudP.x    *= uCloudStretch;       // horizontal aspect ratio (< 1 wider)
      cloudP.x    += uTime * uCloudSpeed; // eastward wind scroll

      // Domain warping on XZ plane (fbm-of-fbm for organic shapes)
      vec2 q = vec2(
        fbmCloud(cloudP),
        fbmCloud(cloudP + vec3(5.2, 1.3, 2.7))
      );
      cloudP.xz += uCloudSkew * (q - 0.5);

      // Grain: high-frequency 3D noise roughens the cloud silhouette
      float grain = (valueNoise3D(cloudP * 6.0) - 0.5) * uCloudGrain;
      float raw   = clamp(fbmCloud(cloudP) + grain, 0.0, 1.0);

      // Density falloff toward the ceiling: from 35% of the band upward the
      // effective density ramps to 0, so clouds thin out and break into
      // smaller separate puffs as they approach the ceiling (no flat fade).
      float ceilT = smoothstep(
        mix(uCloudFloor, uCloudCeiling, 0.35),
        uCloudCeiling,
        dir.y
      );
      float threshold = 1.0 - uCloudDensity * (1.0 - ceilT);

      // Cloud opacity
      float cloud = smoothstep(
        threshold - uCloudSharpness,
        threshold + uCloudSharpness,
        raw
      ) * cloudBand;

      // ── Volume / edge model ──────────────────────────────────────────
      // depth: 0.0 = cloud silhouette edge, 1.0 = deep interior
      float depth      = clamp((raw - threshold) / max(uCloudEdgeWidth, 0.001), 0.0, 1.0);
      float edgeFactor = 1.0 - depth;

      // Moon light cone: angular distance from this cloud fragment to the moon.
      // uMoonLightSoftness controls how wide the gradient is:
      //   0.0 → sharp half-radius cutoff (original behaviour)
      //   1.0 → very soft, inner edge collapses to 0 (full radius is gradient)
      float moonAngDist = acos(clamp(cosA, -1.0, 1.0));
      float innerEdge   = uMoonLightRadius * (1.0 - clamp(uMoonLightSoftness, 0.0, 0.999));
      float moonLight   = 1.0 - smoothstep(innerEdge, uMoonLightRadius, moonAngDist);

      // ── Distance darkening ───────────────────────────────────────────
      // Clouds far from the moon darken — same sky darkening as the background.
      // moonLight (0..1) drives a brightness multiplier.
      float brightness = mix(uCloudDarkenFar, 1.0, moonLight);

      // Base cloud color: core (interior) → edge (boundary), scaled by brightness.
      // No rim baked in — rim is handled separately as a silhouette halo below.
      vec3 cColor = mix(uCloudCore, uCloudEdge, edgeFactor) * brightness;

      color = mix(color, cColor, cloud * uCloudOpacity);

      // ── Rim light: silhouette halo (additive, after composite) ───────
      // cloud * (1 - cloud) peaks at 0.25 where opacity = 0.5 — exactly at
      // the cloud's silhouette boundary. Multiplying by 4 normalises it to 1.0.
      // Applied additively to the ALREADY COMPOSITED color so it glows as a
      // separate halo independent of cloud interior shading — like real backlit
      // cloud edges where light bleeds around the silhouette without tinting the
      // cloud body itself.
      float silhouetteMask = 4.0 * cloud * (1.0 - cloud);
      color += uCloudRim * silhouetteMask * moonLight * uCloudRimStrength;
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface SkyDomeProps {
  /** Called on mount and whenever the sky mode changes with the active preset. */
  onPresetChange?: (preset: SkyPreset) => void;
  /** Written every frame by DayCycleController; drives smooth sky transitions. */
  blendStateRef?: React.MutableRefObject<BlendState>;
  /** When set, programmatically switches the Leva skyMode dropdown. */
  targetMode?: SkyMode;
  /** If provided, SkyDome writes the current (blended) moon/sun world direction
   *  here every frame so other components (SunGlare) can track it. */
  moonDirRef?: React.MutableRefObject<THREE.Vector3>;
  /** Override moon elevation for this scene (degrees). */
  moonElevOverride?: number;
  /** Override moon azimuth for this scene (degrees). */
  moonAzimOverride?: number;
  /** Per-mode preset overrides — merged on top of SKY_PRESETS for this SkyDome instance.
   *  Use this to customize cloud/sky values for a specific scene without changing the global presets. */
  presetOverrides?: Partial<Record<SkyMode, Partial<SkyPreset>>>;
  /** Scene-exclusive presets appended to the Sky Mode dropdown for this
   *  SkyDome instance only (e.g. BOSSFIGHT_SKY_PRESETS on /bossfight). */
  extraPresets?: Record<string, SkyPreset>;
  /** Initial Sky Mode for this scene — may be a key from extraPresets. */
  defaultMode?: string;
}

export default function SkyDome({
  onPresetChange,
  blendStateRef,
  targetMode,
  moonDirRef,
  moonElevOverride,
  moonAzimOverride,
  presetOverrides,
  extraPresets,
  defaultMode,
}: SkyDomeProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  // Pre-allocated Color objects for per-frame blending — zero GC.
  const _cA = useRef(new THREE.Color());
  const _cB = useRef(new THREE.Color());

  const [
    {
      skyMode,
      skyLow,
      skyHigh,
      horizonLine,
      horizonSpread,
      moonElev,
      moonAzim,
      moonColor,
      moonGlowColor,
      moonSize,
      moonGlowFalloff,
      moonGlowIntensity,
      moonEdgeSoftness,
      moonPhasePos,
      moonPhaseSoftness,
      moonPhaseAngle,
      moonEmission,
      moonSpotColor,
      moonSpotScale,
      moonSpotStrength,
      moonSpotThreshold,
      moonSpotSharpness,
      moonSpotOctaves,
      starDensity,
      starSize,
      starBrightness,
      starFloor,
      starDriftY,
      starDriftZ,
      starTwinkleSpeed,
      starTwinkleAmount,
      sideWarp,
      sideTwist,
      auroraIntensity,
      auroraColor1,
      auroraColor2,
      auroraFloor,
      auroraCeil,
      auroraScale,
      auroraSpeed,
      auroraThresh,
      auroraSoft,
      auroraWav,
      cloudSpeed,
      cloudScale,
      cloudDensity,
      cloudSharpness,
      cloudCore,
      cloudEdge,
      cloudRim,
      cloudEdgeWidth,
      cloudRimStrength,
      moonLightRadius,
      moonLightSoftness,
      cloudDarkenFar,
      cloudStretch,
      cloudMorphSpeed,
      cloudFloor,
      cloudCeiling,
      cloudOpacity,
      cloudOctaves,
      cloudAmplitude,
      cloudGrain,
      cloudSkew,
      domeRadius,
      domeOffsetY,
    },
    set,
  ] = useControls(
    "Sky",
    () => ({
      skyMode: {
        value: (defaultMode ?? "day") as string,
        options: Object.fromEntries([
          ...Object.entries(SKY_PRESETS).map(([k, v]) => [v.label, k]),
          ...Object.entries(extraPresets ?? {}).map(([k, v]) => [v.label, k]),
        ]) as Record<string, string>,
        label: "Sky Mode",
      },
      domeRadius: {
        value: 900,
        min: 50,
        max: 1950,
        step: 10,
        label: "Dome Radius",
      },
      domeOffsetY: {
        value: -85,
        min: -200,
        max: 500,
        step: 5,
        label: "Dome Y Offset",
      },
      "Sky Colors": folder(
        {
          skyLow: { value: "#000b69", label: "Horizon" },
          skyHigh: { value: "#00448f", label: "Zenith" },
          horizonLine: {
            value: 0.52,
            min: -0.3,
            max: 0.6,
            step: 0.01,
            label: "Horizon Y",
          },
          horizonSpread: {
            value: 0.05,
            min: 0.05,
            max: 1.0,
            step: 0.05,
            label: "Spread",
          },
        },
        { collapsed: true },
      ),
      Moon: folder(
        {
          moonElev: { value: 8, min: 0, max: 90, step: 1, label: "Elevation" },
          moonAzim: { value: 183, min: 0, max: 360, step: 1, label: "Azimuth" },
          moonColor: { value: "#f0f1f2", label: "Disc Color" },
          moonGlowColor: { value: "#0a7ace", label: "Glow Color" },
          moonSize: {
            value: 0.025,
            min: 0.01,
            max: 0.4,
            step: 0.005,
            label: "Disc Radius",
          },
          moonGlowFalloff: {
            value: 80,
            min: 1,
            max: 80,
            step: 1,
            label: "Glow Falloff",
          },
          moonGlowIntensity: {
            value: 0.35,
            min: 0,
            max: 2.0,
            step: 0.05,
            label: "Glow Intensity",
          },
          moonEdgeSoftness: {
            value: 0.04,
            min: 0.001,
            max: 0.5,
            step: 0.005,
            label: "Edge Softness (0=crisp)",
          },
          moonPhasePos: {
            value: 0.45,
            min: -2.0,
            max: 2.0,
            step: 0.05,
            label: "Phase Position (-=lit, +=dark)",
          },
          moonPhaseSoftness: {
            value: 0.45,
            min: 0.05,
            max: 2.0,
            step: 0.05,
            label: "Phase Softness",
          },
          moonPhaseAngle: {
            value: 150,
            min: -180,
            max: 180,
            step: 1,
            label: "Phase Angle (deg)",
          },
          moonEmission: {
            value: 0.33,
            min: 0,
            max: 2.0,
            step: 0.05,
            label: "Emission",
          },
          moonSpotColor: { value: "#69c2f6", label: "Spot Color" },
          moonSpotScale: {
            value: 2.2,
            min: 0.1,
            max: 6.0,
            step: 0.1,
            label: "Spot Scale",
          },
          moonSpotStrength: {
            value: 0.75,
            min: 0,
            max: 1.0,
            step: 0.05,
            label: "Spot Strength",
          },
          moonSpotThreshold: {
            value: 0.58,
            min: 0.1,
            max: 0.9,
            step: 0.01,
            label: "Spot Threshold",
          },
          moonSpotSharpness: {
            value: 0.15,
            min: 0.005,
            max: 0.3,
            step: 0.005,
            label: "Spot Sharpness (0=hard)",
          },
          moonSpotOctaves: {
            value: 4,
            min: 1,
            max: 6,
            step: 1,
            label: "Spot Octaves",
          },
        },
        { collapsed: true },
      ),
      Stars: folder(
        {
          starDensity: {
            value: 350,
            min: 20,
            max: 350,
            step: 5,
            label: "Density",
          },
          starSize: {
            value: 0.03,
            min: 0.005,
            max: 0.3,
            step: 0.005,
            label: "Size",
          },
          starBrightness: {
            value: 0.5,
            min: 0,
            max: 2.0,
            step: 0.05,
            label: "Brightness",
          },
          starFloor: {
            value: 0.09,
            min: -0.3,
            max: 0.5,
            step: 0.01,
            label: "Floor Y",
          },
          starDriftY: {
            value: 0,
            min: -0.02,
            max: 0.02,
            step: 0.001,
            label: "Drift Y (horizontal)",
          },
          starDriftZ: {
            value: 0,
            min: -0.02,
            max: 0.02,
            step: 0.001,
            label: "Drift Z (roll)",
          },

          starTwinkleSpeed: {
            value: 3,
            min: 0,
            max: 5.0,
            step: 0.1,
            label: "Twinkle Speed",
          },
          starTwinkleAmount: {
            value: 1,
            min: 0,
            max: 1.0,
            step: 0.05,
            label: "Twinkle Amount",
          },
        },
        { collapsed: true },
      ),
      "Side Distortion": folder(
        {
          sideWarp: {
            value: -0.0,
            min: -1.5,
            max: 1.5,
            step: 0.01,
            label: "Side Bend",
          },
          sideTwist: {
            value: -0.33,
            min: -1.0,
            max: 1.0,
            step: 0.01,
            label: "Side Twist",
          },
        },
        { collapsed: true },
      ),
      Aurora: folder(
        {
          auroraIntensity: {
            value: 0.8,
            min: 0,
            max: 3,
            step: 0.05,
            label: "Intensity",
          },
          auroraColor1: { value: "#3affd8", label: "Color Base (low)" },
          auroraColor2: { value: "#7b5bff", label: "Color Tip (high)" },
          auroraFloor: {
            value: 0.09,
            min: -0.3,
            max: 0.9,
            step: 0.01,
            label: "Band Floor Y",
          },
          auroraCeil: {
            value: 0.43,
            min: 0.1,
            max: 1.0,
            step: 0.01,
            label: "Band Ceiling Y",
          },
          auroraScale: {
            value: 9,
            min: 0.5,
            max: 12,
            step: 0.1,
            label: "Curtain Scale",
          },
          auroraSpeed: {
            value: 0.2,
            min: 0,
            max: 0.2,
            step: 0.005,
            label: "Drift Speed",
          },
          auroraThresh: {
            value: 0.77,
            min: 0,
            max: 1,
            step: 0.01,
            label: "Filament Cutoff",
          },
          auroraSoft: {
            value: 0.24,
            min: 0.01,
            max: 0.6,
            step: 0.01,
            label: "Filament Softness",
          },
          auroraWav: {
            value: 2.2,
            min: 0,
            max: 4,
            step: 0.1,
            label: "Waviness",
          },
        },
        { collapsed: true },
      ),
      Clouds: folder(
        {
          // Shape
          cloudSpeed: {
            value: 0.005,
            min: 0,
            max: 0.05,
            step: 0.001,
            label: "Speed",
          },
          cloudScale: {
            value: 23.6,
            min: 0.1,
            max: 50.0,
            step: 0.1,
            label: "Scale",
          },
          cloudDensity: {
            value: 0.53,
            min: 0,
            max: 1.0,
            step: 0.01,
            label: "Density",
          },
          cloudSharpness: {
            value: 0.03,
            min: 0.005,
            max: 0.5,
            step: 0.005,
            label: "Sharpness",
          },
          cloudFloor: {
            value: 0.0,
            min: -0.3,
            max: 0.5,
            step: 0.01,
            label: "Floor Y",
          },
          cloudCeiling: {
            value: 0.63,
            min: 0.1,
            max: 1.0,
            step: 0.01,
            label: "Ceiling Y",
          },
          cloudOpacity: {
            value: 1,
            min: 0,
            max: 1.0,
            step: 0.05,
            label: "Opacity",
          },
          // FBM controls
          cloudOctaves: { value: 6, min: 1, max: 8, step: 1, label: "Octaves" },
          cloudAmplitude: {
            value: 0.54,
            min: 0.2,
            max: 0.85,
            step: 0.01,
            label: "Amplitude (persistence)",
          },
          cloudGrain: {
            value: 0,
            min: 0,
            max: 0.5,
            step: 0.01,
            label: "Grain",
          },
          cloudSkew: {
            value: 0,
            min: 0,
            max: 3.0,
            step: 0.05,
            label: "Skew (domain warp)",
          },
          // Volume colors
          cloudCore: { value: "#00348a", label: "Core (interior)" },
          cloudEdge: { value: "#0a7cc7", label: "Edge" },
          cloudRim: { value: "#8bbfee", label: "Rim (moon-lit)" },
          cloudEdgeWidth: {
            value: 0.07,
            min: 0.05,
            max: 1.0,
            step: 0.01,
            label: "Edge Width",
          },
          cloudRimStrength: {
            value: 4.5,
            min: 0,
            max: 6.0,
            step: 0.1,
            label: "Rim Emission Strength",
          },
          moonLightRadius: {
            value: 0.05,
            min: 0.01,
            max: 3.14,
            step: 0.01,
            label: "Moon Light Radius (rad)",
          },
          moonLightSoftness: {
            value: 0.54,
            min: 0,
            max: 0.99,
            step: 0.01,
            label: "Moon Light Softness",
          },
          cloudDarkenFar: {
            value: 0.8,
            min: 0,
            max: 1.0,
            step: 0.05,
            label: "Darken Far (0=black, 1=off)",
          },
          cloudStretch: {
            value: 0.5,
            min: 0.1,
            max: 10.0,
            step: 0.05,
            label: "Stretch X",
          },
          cloudMorphSpeed: {
            value: 0.06,
            min: 0,
            max: 0.3,
            step: 0.005,
            label: "Morph Speed",
          },
        },
        { collapsed: true },
      ),
    }),
    { collapsed: true },
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uSkyLow: { value: new THREE.Color("#011851") },
          uSkyHigh: { value: new THREE.Color("#011f9d") },
          uHorizonLine: { value: 0.1 },
          uHorizonSpread: { value: 0.35 },
          uMoonDir: { value: new THREE.Vector3(0, 0.6, -0.8).normalize() },
          uMoonColor: { value: new THREE.Color("#fff8d0") },
          uMoonGlowColor: { value: new THREE.Color("#1a3580") },
          uMoonSize: { value: 0.06 },
          uMoonGlowFalloff: { value: 8 },
          uMoonGlowIntensity: { value: 0.6 },
          uMoonEdgeSoftness: { value: 0.02 },
          uMoonPhasePos: { value: 0.3 },
          uMoonPhaseSoftness: { value: 0.2 },
          uMoonPhaseAngle: { value: 0.0 },
          uMoonEmission: { value: 0.35 },
          uMoonSpotColor: { value: new THREE.Color("#3a6ab5") },
          uMoonSpotScale: { value: 1.8 },
          uMoonSpotStrength: { value: 0.8 },
          uMoonSpotThreshold: { value: 0.55 },
          uMoonSpotSharpness: { value: 0.04 },
          uMoonSpotOctaves: { value: 4 },
          uSideWarp: { value: 0 },
          uSideTwist: { value: 0 },
          uAuroraIntensity: { value: 0 },
          uAuroraColor1: { value: new THREE.Color("#3affd8") },
          uAuroraColor2: { value: new THREE.Color("#7b5bff") },
          uAuroraFloor: { value: 0.15 },
          uAuroraCeil: { value: 0.75 },
          uAuroraScale: { value: 3.0 },
          uAuroraSpeed: { value: 0.02 },
          uAuroraThresh: { value: 0.55 },
          uAuroraSoft: { value: 0.25 },
          uAuroraWav: { value: 1.5 },
          uStarDensity: { value: 150 },
          uStarSize: { value: 0.03 },
          uStarBrightness: { value: 2.0 },
          uStarFloor: { value: 0.0 },
          uStarDriftY: { value: 0.002 },
          uStarDriftZ: { value: 0.0 },
          uStarTwinkleSpeed: { value: 1.2 },
          uStarTwinkleAmount: { value: 0.5 },
          uTime: { value: 0 },
          uCloudMorphSpeed: { value: 0.03 },
          uCloudSpeed: { value: 0 },
          uCloudScale: { value: 2.2 },
          uCloudDensity: { value: 0.45 },
          uCloudSharpness: { value: 0.06 },
          uCloudCore: { value: new THREE.Color("#030d1f") },
          uCloudEdge: { value: new THREE.Color("#2a5299") },
          uCloudRim: { value: new THREE.Color("#8bbfee") },
          uCloudEdgeWidth: { value: 0.35 },
          uCloudRimStrength: { value: 1.7 },
          uMoonLightRadius: { value: 0.06 },
          uMoonLightSoftness: { value: 0.5 },
          uCloudDarkenFar: { value: 0.25 },
          uCloudStretch: { value: 0.6 },
          uCloudFloor: { value: 0.04 },
          uCloudCeiling: { value: 1.0 },
          uCloudOpacity: { value: 0.9 },
          uCloudOctaves: { value: 6 },
          uCloudAmplitude: { value: 0.5 },
          uCloudGrain: { value: 0.08 },
          uCloudSkew: { value: 0.6 },
        },
      }),
    [],
  );

  // When skyMode changes, push preset values into Leva so sliders reflect the
  // preset — then the user can tweak freely without the preset overriding them.
  // DEFAULT_SKY mirrors the Leva initial values so fields the new preset doesn't
  // define get reset to the baseline (avoids bleed-over from the previous preset).
  useEffect(() => {
    const mode = skyMode as SkyMode;
    // Scene-exclusive presets (extraPresets) take priority over global modes
    const basePreset = extraPresets?.[skyMode] ?? SKY_PRESETS[mode];
    if (!basePreset) return;
    const overrides = presetOverrides?.[mode];
    const preset: SkyPreset = overrides
      ? { ...basePreset, ...overrides }
      : basePreset;
    set({
      // ── Sky gradient defaults ──────────────────────────────────────────────
      skyLow: "#000b69",
      skyHigh: "#00448f",
      horizonLine: 0.52,
      horizonSpread: 0.05,
      // ── Moon defaults ─────────────────────────────────────────────────────
      moonElev: -8,
      moonAzim: 183,
      moonColor: "#f0f1f2",
      moonGlowColor: "#0a7ace",
      moonSize: 0.025,
      moonGlowFalloff: 80,
      moonGlowIntensity: 0.35,
      moonEdgeSoftness: 0.04,
      moonPhasePos: 0.45,
      moonPhaseSoftness: 0.45,
      moonPhaseAngle: 150,
      moonEmission: 0.33,
      moonSpotColor: "#69c2f6",
      moonSpotStrength: 0.75,
      // ── Cloud defaults ────────────────────────────────────────────────────
      cloudScale: 23.6,
      cloudDensity: 0.53,
      cloudSharpness: 0.03,
      cloudFloor: 0.0,
      cloudAmplitude: 0.54,
      cloudGrain: 0,
      cloudCore: "#00348a",
      cloudEdge: "#0a7cc7",
      cloudRim: "#8bbfee",
      cloudEdgeWidth: 0.07,
      cloudRimStrength: 4.5,
      cloudDarkenFar: 0.8,
      cloudStretch: 0.5,
      cloudMorphSpeed: 0.06,
      moonLightRadius: 0.05,
      moonLightSoftness: 0.54,
      cloudSpeed: 0.005,
      cloudCeiling: 0.63,
      // ── Aurora defaults ───────────────────────────────────────────────────
      auroraIntensity: 0.8,
      auroraColor1: "#3affd8",
      auroraColor2: "#7b5bff",
      // ── Preset overrides (only fields the preset defines) ─────────────────
      ...(preset.starDensity !== undefined && {
        starDensity: preset.starDensity,
      }),
      ...(preset.starSize !== undefined && { starSize: preset.starSize }),
      ...(preset.starBrightness !== undefined && {
        starBrightness: preset.starBrightness,
      }),
      ...(preset.starFloor !== undefined && { starFloor: preset.starFloor }),
      ...(preset.skyLow !== undefined && { skyLow: preset.skyLow }),
      ...(preset.skyHigh !== undefined && { skyHigh: preset.skyHigh }),
      ...(preset.horizonLine !== undefined && {
        horizonLine: preset.horizonLine,
      }),
      ...(preset.horizonSpread !== undefined && {
        horizonSpread: preset.horizonSpread,
      }),
      ...(preset.moonElev !== undefined && { moonElev: preset.moonElev }),
      ...(preset.moonAzim !== undefined && { moonAzim: preset.moonAzim }),
      // Scene-level overrides take priority over preset values
      ...(moonElevOverride !== undefined && { moonElev: moonElevOverride }),
      ...(moonAzimOverride !== undefined && { moonAzim: moonAzimOverride }),
      ...(preset.moonColor !== undefined && { moonColor: preset.moonColor }),
      ...(preset.moonGlowColor !== undefined && {
        moonGlowColor: preset.moonGlowColor,
      }),
      ...(preset.moonSize !== undefined && { moonSize: preset.moonSize }),
      ...(preset.moonGlowFalloff !== undefined && {
        moonGlowFalloff: preset.moonGlowFalloff,
      }),
      ...(preset.moonGlowIntensity !== undefined && {
        moonGlowIntensity: preset.moonGlowIntensity,
      }),
      ...(preset.moonEdgeSoftness !== undefined && {
        moonEdgeSoftness: preset.moonEdgeSoftness,
      }),
      ...(preset.moonPhasePos !== undefined && {
        moonPhasePos: preset.moonPhasePos,
      }),
      ...(preset.moonPhaseSoftness !== undefined && {
        moonPhaseSoftness: preset.moonPhaseSoftness,
      }),
      ...(preset.moonPhaseAngle !== undefined && {
        moonPhaseAngle: preset.moonPhaseAngle,
      }),
      ...(preset.moonEmission !== undefined && {
        moonEmission: preset.moonEmission,
      }),
      ...(preset.moonSpotColor !== undefined && {
        moonSpotColor: preset.moonSpotColor,
      }),
      ...(preset.moonSpotStrength !== undefined && {
        moonSpotStrength: preset.moonSpotStrength,
      }),
      ...(preset.cloudScale !== undefined && { cloudScale: preset.cloudScale }),
      ...(preset.cloudDensity !== undefined && {
        cloudDensity: preset.cloudDensity,
      }),
      ...(preset.cloudSharpness !== undefined && {
        cloudSharpness: preset.cloudSharpness,
      }),
      ...(preset.cloudOctaves !== undefined && {
        cloudOctaves: preset.cloudOctaves,
      }),
      ...(preset.cloudFloor !== undefined && { cloudFloor: preset.cloudFloor }),
      ...(preset.cloudAmplitude !== undefined && {
        cloudAmplitude: preset.cloudAmplitude,
      }),
      ...(preset.cloudGrain !== undefined && { cloudGrain: preset.cloudGrain }),
      ...(preset.cloudCore !== undefined && { cloudCore: preset.cloudCore }),
      ...(preset.cloudEdge !== undefined && { cloudEdge: preset.cloudEdge }),
      ...(preset.cloudRim !== undefined && { cloudRim: preset.cloudRim }),
      ...(preset.cloudEdgeWidth !== undefined && {
        cloudEdgeWidth: preset.cloudEdgeWidth,
      }),
      ...(preset.cloudRimStrength !== undefined && {
        cloudRimStrength: preset.cloudRimStrength,
      }),
      ...(preset.cloudDarkenFar !== undefined && {
        cloudDarkenFar: preset.cloudDarkenFar,
      }),
      ...(preset.cloudStretch !== undefined && {
        cloudStretch: preset.cloudStretch,
      }),
      ...(preset.cloudMorphSpeed !== undefined && {
        cloudMorphSpeed: preset.cloudMorphSpeed,
      }),
      ...(preset.moonLightRadius !== undefined && {
        moonLightRadius: preset.moonLightRadius,
      }),
      ...(preset.moonLightSoftness !== undefined && {
        moonLightSoftness: preset.moonLightSoftness,
      }),
      ...(preset.cloudSpeed !== undefined && { cloudSpeed: preset.cloudSpeed }),
      ...(preset.cloudCeiling !== undefined && {
        cloudCeiling: preset.cloudCeiling,
      }),
      ...(preset.auroraIntensity !== undefined && {
        auroraIntensity: preset.auroraIntensity,
      }),
      ...(preset.auroraColor1 !== undefined && {
        auroraColor1: preset.auroraColor1,
      }),
      ...(preset.auroraColor2 !== undefined && {
        auroraColor2: preset.auroraColor2,
      }),
    });
    onPresetChange?.(preset);
  }, [skyMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the day-cycle controller completes a transition it passes a targetMode
  // here — this pushes it into Leva so the dropdown and preset system update.
  useEffect(() => {
    if (targetMode) set({ skyMode: targetMode });
  }, [targetMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ camera, clock }) => {
    // Dome follows camera XZ; Y offset lifts the sphere centre above the camera
    // so horizontal rays hit the dome with dir.y < cloudFloor, hiding the cloud
    // UV deformation that occurs when dir.y → 0 (dir.xz / safeY blows up).
    meshRef.current.position.set(
      camera.position.x,
      camera.position.y + domeOffsetY,
      camera.position.z,
    );
    meshRef.current.scale.setScalar(domeRadius);

    const u = material.uniforms;
    const basePreset =
      extraPresets?.[skyMode] ??
      SKY_PRESETS[skyMode as SkyMode] ??
      SKY_PRESETS.night;
    const modeOverrides = presetOverrides?.[skyMode as SkyMode];
    const preset: SkyPreset = modeOverrides
      ? { ...basePreset, ...modeOverrides }
      : basePreset;

    // All values come from Leva — preset syncs them via set() on skyMode change.
    // Only feature flags (starsEnabled, moonEnabled, cloudsEnabled) still come
    // directly from the preset so toggling the mode always gates those features.
    u.uSkyLow.value.set(skyLow);
    u.uSkyHigh.value.set(skyHigh);
    u.uHorizonLine.value = horizonLine;
    u.uHorizonSpread.value = horizonSpread;

    const elRad = moonElev * (Math.PI / 180);
    const azRad = moonAzim * (Math.PI / 180);
    u.uMoonDir.value.set(
      Math.cos(elRad) * Math.sin(azRad),
      Math.sin(elRad),
      Math.cos(elRad) * Math.cos(azRad),
    );
    // Share moon direction with other components (e.g. SunGlare).
    if (moonDirRef) moonDirRef.current.copy(u.uMoonDir.value);
    u.uMoonColor.value.set(moonColor);
    u.uMoonGlowColor.value.set(moonGlowColor);
    u.uMoonSize.value = preset.moonEnabled ? moonSize : 0;
    u.uMoonGlowFalloff.value = moonGlowFalloff;
    u.uMoonGlowIntensity.value = moonGlowIntensity;
    u.uMoonEdgeSoftness.value = moonEdgeSoftness;
    u.uMoonPhasePos.value = moonPhasePos;
    u.uMoonPhaseSoftness.value = moonPhaseSoftness;
    u.uMoonPhaseAngle.value = moonPhaseAngle * (Math.PI / 180);
    u.uMoonEmission.value = moonEmission;
    u.uMoonSpotColor.value.set(moonSpotColor);
    u.uMoonSpotScale.value = moonSpotScale;
    u.uMoonSpotStrength.value = moonSpotStrength;
    u.uMoonSpotThreshold.value = moonSpotThreshold;
    u.uMoonSpotSharpness.value = moonSpotSharpness;
    u.uMoonSpotOctaves.value = moonSpotOctaves;

    // Stars — brightness forced to 0 by feature flag (e.g. daytime)
    u.uStarDensity.value = starDensity;
    u.uStarSize.value = starSize;
    u.uStarBrightness.value = preset.starsEnabled ? starBrightness : 0;
    u.uStarFloor.value = starFloor;
    u.uStarDriftY.value = starDriftY;
    u.uStarDriftZ.value = starDriftZ;
    u.uStarTwinkleSpeed.value = starTwinkleSpeed;
    u.uStarTwinkleAmount.value = starTwinkleAmount;

    // Side distortion — forced to 0 unless the preset enables it (boss fight)
    u.uSideWarp.value = preset.sideDistortionEnabled ? sideWarp : 0;
    u.uSideTwist.value = preset.sideDistortionEnabled ? sideTwist : 0;

    // Aurora — intensity forced to 0 unless the preset enables it
    u.uAuroraIntensity.value = preset.auroraEnabled ? auroraIntensity : 0;
    u.uAuroraColor1.value.set(auroraColor1);
    u.uAuroraColor2.value.set(auroraColor2);
    u.uAuroraFloor.value = auroraFloor;
    u.uAuroraCeil.value = auroraCeil;
    u.uAuroraScale.value = auroraScale;
    u.uAuroraSpeed.value = auroraSpeed;
    u.uAuroraThresh.value = auroraThresh;
    u.uAuroraSoft.value = auroraSoft;
    u.uAuroraWav.value = auroraWav;

    // Clouds — all values from Leva; cloudsEnabled feature flag from preset
    u.uTime.value = clock.elapsedTime;
    u.uCloudMorphSpeed.value = cloudMorphSpeed;
    u.uCloudSpeed.value = cloudSpeed;
    u.uCloudScale.value = cloudScale;
    u.uCloudDensity.value = cloudDensity;
    u.uCloudSharpness.value = cloudSharpness;
    u.uCloudCore.value.set(cloudCore);
    u.uCloudEdge.value.set(cloudEdge);
    u.uCloudRim.value.set(cloudRim);
    u.uCloudEdgeWidth.value = cloudEdgeWidth;
    u.uCloudRimStrength.value = cloudRimStrength;
    u.uMoonLightRadius.value = moonLightRadius;
    u.uMoonLightSoftness.value = moonLightSoftness;
    u.uCloudDarkenFar.value = cloudDarkenFar;
    u.uCloudStretch.value = cloudStretch;
    u.uCloudFloor.value = cloudFloor;
    u.uCloudCeiling.value = cloudCeiling;
    // cloudsEnabled gates opacity; preset value takes priority over Leva
    u.uCloudOpacity.value = preset.cloudsEnabled
      ? (preset.cloudOpacity ?? cloudOpacity)
      : 0;
    u.uCloudOctaves.value = cloudOctaves;
    u.uCloudAmplitude.value = cloudAmplitude;
    u.uCloudGrain.value = cloudGrain;
    u.uCloudSkew.value = cloudSkew;

    // ── Day-cycle blend: override Leva-driven uniforms during transitions ─────
    const bs = blendStateRef?.current;
    if (bs?.active) {
      const { from, to, t } = bs;
      const cA = _cA.current;
      const cB = _cB.current;

      // Sky gradient
      cA.set(from.skyLow ?? "#000b69");
      cB.set(to.skyLow ?? "#000b69");
      u.uSkyLow.value.lerpColors(cA, cB, t);
      cA.set(from.skyHigh ?? "#00448f");
      cB.set(to.skyHigh ?? "#00448f");
      u.uSkyHigh.value.lerpColors(cA, cB, t);
      u.uHorizonLine.value = lerp(
        from.horizonLine ?? 0.52,
        to.horizonLine ?? 0.52,
        t,
      );
      u.uHorizonSpread.value = lerp(
        from.horizonSpread ?? 0.05,
        to.horizonSpread ?? 0.05,
        t,
      );

      // Moon direction
      const elA = (from.moonElev ?? 8) * (Math.PI / 180);
      const elB = (to.moonElev ?? 8) * (Math.PI / 180);
      const azA = (from.moonAzim ?? 183) * (Math.PI / 180);
      const azB = (to.moonAzim ?? 183) * (Math.PI / 180);
      const el = lerp(elA, elB, t);
      const az = lerp(azA, azB, t);
      u.uMoonDir.value.set(
        Math.cos(el) * Math.sin(az),
        Math.sin(el),
        Math.cos(el) * Math.cos(az),
      );
      if (moonDirRef) moonDirRef.current.copy(u.uMoonDir.value);

      // Moon appearance
      cA.set(from.moonColor ?? "#f0f1f2");
      cB.set(to.moonColor ?? "#f0f1f2");
      u.uMoonColor.value.lerpColors(cA, cB, t);
      cA.set(from.moonGlowColor ?? "#0a7ace");
      cB.set(to.moonGlowColor ?? "#0a7ace");
      u.uMoonGlowColor.value.lerpColors(cA, cB, t);
      u.uMoonSize.value = lerp(
        from.moonEnabled ? (from.moonSize ?? 0.025) : 0,
        to.moonEnabled ? (to.moonSize ?? 0.025) : 0,
        t,
      );
      u.uMoonEmission.value = lerp(
        from.moonEmission ?? 0.33,
        to.moonEmission ?? 0.33,
        t,
      );
      u.uMoonGlowFalloff.value = lerp(
        from.moonGlowFalloff ?? 80,
        to.moonGlowFalloff ?? 80,
        t,
      );
      u.uMoonGlowIntensity.value = lerp(
        from.moonGlowIntensity ?? 0.35,
        to.moonGlowIntensity ?? 0.35,
        t,
      );

      // Stars
      u.uStarBrightness.value = lerp(
        from.starsEnabled ? starBrightness : 0,
        to.starsEnabled ? starBrightness : 0,
        t,
      );

      // Cloud colors
      // Cloud shape
      u.uCloudDensity.value = lerp(
        from.cloudDensity ?? 0.53,
        to.cloudDensity ?? 0.53,
        t,
      );
      u.uCloudScale.value = lerp(
        from.cloudScale ?? 23.6,
        to.cloudScale ?? 23.6,
        t,
      );
      u.uCloudSharpness.value = lerp(
        from.cloudSharpness ?? 0.03,
        to.cloudSharpness ?? 0.03,
        t,
      );
      u.uCloudAmplitude.value = lerp(
        from.cloudAmplitude ?? 0.54,
        to.cloudAmplitude ?? 0.54,
        t,
      );
      u.uCloudGrain.value = lerp(from.cloudGrain ?? 0, to.cloudGrain ?? 0, t);
      u.uCloudEdgeWidth.value = lerp(
        from.cloudEdgeWidth ?? 0.07,
        to.cloudEdgeWidth ?? 0.07,
        t,
      );

      // Cloud colors
      cA.set(from.cloudCore ?? "#00348a");
      cB.set(to.cloudCore ?? "#00348a");
      u.uCloudCore.value.lerpColors(cA, cB, t);
      cA.set(from.cloudEdge ?? "#0a7cc7");
      cB.set(to.cloudEdge ?? "#0a7cc7");
      u.uCloudEdge.value.lerpColors(cA, cB, t);
      cA.set(from.cloudRim ?? "#8bbfee");
      cB.set(to.cloudRim ?? "#8bbfee");
      u.uCloudRim.value.lerpColors(cA, cB, t);
      u.uCloudRimStrength.value = lerp(
        from.cloudRimStrength ?? 4.5,
        to.cloudRimStrength ?? 4.5,
        t,
      );
      u.uCloudDarkenFar.value = lerp(
        from.cloudDarkenFar ?? 0.8,
        to.cloudDarkenFar ?? 0.8,
        t,
      );
      u.uCloudFloor.value = lerp(
        from.cloudFloor ?? 0.0,
        to.cloudFloor ?? 0.0,
        t,
      );
      u.uMoonLightRadius.value = lerp(
        from.moonLightRadius ?? 0.05,
        to.moonLightRadius ?? 0.05,
        t,
      );
      u.uMoonLightSoftness.value = lerp(
        from.moonLightSoftness ?? 0.54,
        to.moonLightSoftness ?? 0.54,
        t,
      );
      u.uCloudOpacity.value = lerp(
        from.cloudsEnabled ? (from.cloudOpacity ?? cloudOpacity) : 0,
        to.cloudsEnabled ? (to.cloudOpacity ?? cloudOpacity) : 0,
        t,
      );
    }
  });

  return (
    <mesh ref={meshRef} renderOrder={-100}>
      <sphereGeometry args={[DOME_RADIUS, 32, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
