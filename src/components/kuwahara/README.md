# Anisotropic Kuwahara — oil paint in screen space

A post-processing filter that makes a rendered scene look **painted**, by
smoothing every pixel with the flattest patch of its neighbourhood and refusing
to smooth across contours. Unlike a stylized _material_, it does not care what
the scene is made of: models keep their own textures and lighting, and the paint
happens afterwards, to the image.

```
kuwahara/
├── AnisotropicKuwaharaPass.ts   the filter. three + postprocessing only.
├── KuwaharaFilter.tsx           the same thing with a Leva panel (React)
├── glsl/
│   ├── structureTensor.ts         pass 1 — which way the image flows
│   └── anisotropicKuwahara.ts     pass 2 — the paint
└── index.ts
```

The smallest scene that shows what it does lives at
`src/components/painterlyStarter/`, on the `/painterly-starter` route: a torus
knot, a shadow-only ground, and two effects in the composer — this filter with
its debug views switched on, then the watercolour grade. Those two are the
whole painterly look; the castle demo adds fog, bloom, a flare and a colour
overlay on top, which is why it reads so much stronger.

## Use

Inside the composer from `@react-three/postprocessing`, **first**, so anything
after it works on the painted image:

```tsx
<EffectComposer>
  <KuwaharaFilter folder="Paint" defaults={{ radius: 6 }} />
  <Bloom intensity={0.3} />
</EffectComposer>
```

Without React:

```ts
composer.addPass(new AnisotropicKuwaharaPass({ radius: 5 }));
```

`KUWAHARA_DEFAULTS` is the single source of truth for the starting values, read
by both the pass constructor and the Leva panel. They are tuned values, not the
reference implementation's — see [Provenance](#provenance).

### Where it goes in the chain

"First" is the rule, and it holds for anything that only reads colour — bloom,
a grade, a tone map. It **bends for any pass that reads the depth buffer**: a
lens flare testing occlusion, SSAO, depth-based fog.

`postprocessing` attaches the scene's depth texture to the composer's *initial*
input buffer. Every pass with `needsSwap` flips input and output, so a few
passes in, that attachment has been used as a render target and cleared — depth
comes back as 1.0 and a flare reads "open sky everywhere". Those passes have to
run before this one, which puts the paint last.

`PainterlySceneContent` is the real case: height fog, then lens flare, then the
paint. The flare being painted afterwards is arguably right anyway — everything
else in frame is painted, so an unpainted flare would be the one thing that is
not.

## Debug views

`showDebug` adds a dropdown that swaps the paint for a picture of one of the
filter's own intermediate values, plus a before/after wipe. Off by default.

```tsx
<KuwaharaFilter folder="Paint" showDebug />
```

| view                    | what you are looking at                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **1 · Structure tensor** | pass 1's raw output, `(Jxx, Jyy, \|Jxy\|)` range-compressed. Edges light up; flat areas are black. |
| **2 · Flow direction**   | the dominant eigenvector as hue, dimmed by anisotropy. Its period is **π, not 2π** — the two sides of one edge get the same hue, which is the sign-blindness the squaring buys. |
| **3 · Anisotropy**       | `(λ1 − λ2) / (λ1 + λ2)`. White = the kernel stretches hard here; black = it stays round. |
| **4 · Winning sector**   | which of the 8 sectors was flattest, one hue each. Large flat fields are patches smoothed as one; mosaic is where it kept switching. |
| **5 · Sector variance**  | how flat "flattest" actually was, `sqrt`-lifted to be visible.                          |
| **6 · Isotropic (naive)**| the paint with anisotropy forced to 0 — the round-kernel Kuwahara, soap-bubble blobs and all. The before to everything else's after. |

The wipe (`split`, 0–1) shows the untouched input left of the seam and the
current view right of it, with a hairline between.

All of it is optional and marked as such in the source: one uniform pair, one
helper, one `if` chain in the shader, and the bottom half of `KuwaharaFilter.tsx`.
Delete them and the filter is unchanged.

Note the debug views are written to a linear buffer and sRGB-encoded by the
composer's final pass like everything else, so the greyscale ramps read lifted.
Fine for looking at; do not read exact values off them.

## How it works

**Kuwahara**, in one sentence: split the disc around a pixel into sectors, and
take the average colour of whichever sector has the lowest variance. Averaging
smooths; always picking the calmest sector means the smoothing never crosses an
edge. The image comes out as flat patches meeting at hard boundaries — a blur
that refuses to blur across contours, which is what a loaded brush leaves.

**Anisotropic** is the half that stops it looking like a filter. A circular
kernel gives round, soap-bubble blobs — the tell of a naive Kuwahara. So pass 1
computes a **structure tensor** (Sobel gradients, squared and cross-multiplied)
whose eigenvectors give the local flow direction and whose eigenvalue spread
gives how strongly the image flows that way. Pass 2 rotates its kernel onto that
direction and squeezes it by that strength:

| where              | anisotropy | kernel                   |
| ------------------ | ---------- | ------------------------ |
| flat region        | ≈ 0        | stays round              |
| along a crisp edge | → 1        | stretches along the edge |

so strokes run along a beam instead of dissolving it into pebbles.

The tensor is squared on purpose: direction is wanted without a sign. An edge
running up-left is the same edge running down-right, and averaging raw gradients
would cancel it to zero.

## Cost

`SECTOR_COUNT × radius × 5` texture fetches per pixel — at the default radius 5
that is **200 samples**, full screen, every frame. `radius` is the knob that
pays for it, and it is also the brush size, so the cheap setting and the subtle
setting are the same setting. Cut the canvas `dpr` before cutting the radius:
the filter is fill-rate bound, so resolution is the cheaper lever.

## Provenance

Adapted from Maxime Heckel's anisotropic Kuwahara implementation. Two deliberate
departures, both about where this version sits:

- **No `fromLinear()`.** That version writes straight to the screen and encodes
  sRGB itself. This one runs inside postprocessing's composer, which works in
  linear and lets the final `EffectPass` encode — doing it here too would gamma
  the image twice.
- **No second scene render.** That version renders the scene again into an FBO
  to keep an unfiltered copy to sample. In a pass chain the composer's input
  buffer already is that copy, so the scene is rendered once.

Plus one portability fix: the sampling loops are bounded by a constant with an
early `break` rather than tested against the radius uniform, which GLSL ES 1.00
will not compile.

## The `alpha` knob saturates fast

`alpha` is an eccentricity limit, and the curve is steeper than it looks. For a
fully directional pixel (anisotropy → 1):

| alpha | scaleX / scaleY | kernel   |
| ----- | --------------- | -------- |
| 1     | 0.50 / 2.00     | 4 : 1    |
| 2     | 0.67 / 1.50     | 2.25 : 1 |
| 5     | 0.83 / 1.20     | 1.44 : 1 |
| 25    | 0.96 / 1.04     | 1.08 : 1 |

So anything past roughly 20 is a circle, and the filter is an ordinary
**isotropic** Kuwahara wearing the name. The whole effect lives in the low
single digits, which is why the default is 2 and the slider tops out at 25.

## A note on the kernel transform

The rotation is composed **before** the scale and applied as `M * v`:

```glsl
mat2 rotation = mat2(orientation.x, orientation.y, -orientation.y, orientation.x);
mat2 anisotropyMat = rotation * mat2(scaleX, 0.0, 0.0, scaleY);
...
sampleOffset = anisotropyMat * sampleOffset;
```

Writing the last line as `sampleOffset *= anisotropyMat` looks equivalent and
is not: in GLSL `v * M` means `transpose(M) * v`, which flips the composition
to scale-**after**-rotate. The sample disc gets rotated (a disc is rotation
invariant, so nothing happens) and then squashed along the screen axes, so the
kernel is an ellipse whose long axis is always screen-vertical regardless of
where the image actually flows.

It is a quiet failure, because at a high `alpha` the ellipse is round enough
that nothing looks wrong — the two mistakes hide each other. Turn `alpha` down
to 1 and switch between the paint and the **Isotropic (naive)** debug view: if
they differ only in how blobby they are, and not in which way the strokes run,
the transform is composed the wrong way round.
