import * as THREE from "three";
import { makeNoise2D } from "./noise2d";

// ─────────────────────────────────────────────────────────────────────────────
// grainTexture — a zero-asset greyscale grain field for `painterlyMaterial`.
//
// That material wants a GREYSCALE height-ish map (see painterlyMaterial.ts); a
// scanned bark/rock height map is the better source when the project has one.
// This exists so the folder works dropped into a project with no textures at
// all, and so the look can be judged before art arrives.
//
// Built as a DataTexture rather than off a <canvas>: no DOM, so it is safe on a
// server render, and the fbm is cheap enough (a 256² map is ~65k samples) that
// generating it costs less than fetching a PNG would.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrainTextureOptions {
  size?: number;
  /**
   * Anisotropy of the noise. >1 stretches the cells ALONG v, which is what
   * turns blobs into fibres — wood and stone strata both read this way.
   */
  stretch?: number;
  /** Base cell count across the map before octaves. */
  frequency?: number;
  octaves?: number;
  /** Pushes the histogram toward black/white. 1 = raw fbm. */
  contrast?: number;
  seed?: number;
}


export function makeProceduralGrainTexture(
  opts: GrainTextureOptions = {},
): THREE.DataTexture {
  const {
    size = 256,
    stretch = 6,
    frequency = 6,
    octaves = 5,
    contrast = 1.6,
    seed = 1,
  } = opts;

  const noise = makeNoise2D(seed);
  const data = new Uint8Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let sum = 0;
      let amp = 1;
      let norm = 0;
      let freq = frequency;
      for (let o = 0; o < octaves; o++) {
        // The period passed to the hash is the lattice size at THIS octave, so
        // every octave wraps and the sum stays tileable.
        const px = Math.max(1, Math.round(freq));
        const py = Math.max(1, Math.round(freq * stretch));
        sum += noise(u * px, v * py, Math.max(px, py)) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      let n = sum / norm;
      // Ridged term: abs() around the midpoint turns smooth blobs into creased
      // lines, which is what makes it read as fibre rather than as clouds.
      n = 1 - Math.abs(n * 2 - 1);
      n = Math.pow(n, contrast);
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(n * 255)));
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace; // data, not colour
  tex.needsUpdate = true;
  return tex;
}
