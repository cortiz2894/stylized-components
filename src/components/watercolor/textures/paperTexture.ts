import * as THREE from "three";
import { makeNoise2D } from "./noise2d";
import type { GrainTextureOptions } from "./grainTexture";

// ─────────────────────────────────────────────────────────────────────────────
// paperTexture — a zero-asset paper-tooth NORMAL map for `watercolorMaterial`.
//
// A DataTexture rather than a <canvas>: no DOM, so it is safe on a server
// render, and generating a 256² map costs less than fetching a PNG would.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaperNormalOptions extends GrainTextureOptions {
  /** How far the fibres tilt the surface. Higher = more visible tooth. */
  strength?: number;
}

/**
 * A paper-tooth NORMAL map, for `watercolorMaterial`'s paint map slot.
 *
 * Same fbm as the grain above, but isotropic (stretch 1 — paper has a weave,
 * not a direction) and turned into normals by central differences rather than
 * being used as a height directly, because that slot expects a normal map.
 *
 * Tangent-space convention, encoded to [0,1] the usual way. Sampled with wrap,
 * so it tiles.
 */
export function makePaperNormalTexture(
  opts: PaperNormalOptions = {},
): THREE.DataTexture {
  const {
    size = 256,
    stretch = 1,
    frequency = 24,
    octaves = 4,
    contrast = 1,
    seed = 7,
    strength = 2,
  } = opts;

  const noise = makeNoise2D(seed);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let sum = 0;
      let amp = 1;
      let norm = 0;
      let freq = frequency;
      for (let o = 0; o < octaves; o++) {
        const px = Math.max(1, Math.round(freq));
        const py = Math.max(1, Math.round(freq * stretch));
        sum += noise(u * px, v * py, Math.max(px, py)) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      height[y * size + x] = Math.pow(sum / norm, contrast);
    }
  }

  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)];

  // RGBA, not RGB: three dropped real RGB8 texture support (the constant is a
  // deprecation stub), and an RGBA row is always 4-byte aligned for free.
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Central differences, and the neighbours wrap — a normal map built off a
      // clamped edge shows a bright seam wherever it tiles.
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace; // data, not colour
  tex.needsUpdate = true;
  return tex;
}
