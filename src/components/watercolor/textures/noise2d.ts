// ─────────────────────────────────────────────────────────────────────────────
// noise2d — the CPU-side noise both texture generators are built on.
//
// Tileable by construction: the lattice wraps at `period`, so a texture built
// from it repeats with no seam. A plain hash-of-integer-coords noise does not,
// and that seam is the first thing a viewer's eye finds on a tiled surface.
// ─────────────────────────────────────────────────────────────────────────────

export function makeNoise2D(seed: number) {
  const hash = (xi: number, yi: number, period: number) => {
    const x = ((xi % period) + period) % period;
    const y = ((yi % period) + period) % period;
    let h = x * 374761393 + y * 668265263 + seed * 1442695040;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, period: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = fade(x - xi);
    const fy = fade(y - yi);
    const a = hash(xi, yi, period);
    const b = hash(xi + 1, yi, period);
    const c = hash(xi, yi + 1, period);
    const d = hash(xi + 1, yi + 1, period);
    return (
      a * (1 - fx) * (1 - fy) +
      b * fx * (1 - fy) +
      c * (1 - fx) * fy +
      d * fx * fy
    );
  };
}
