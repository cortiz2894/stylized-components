# Volumetric light — shafts out of the sky the dome is drawing

Sunlight through a canopy is not a glow around the sun; it is the **shadow of
everything standing in front of it**, drawn in the air. Which means the effect is
not really about light at all — it is about what is in the way, and that is
something a depth buffer already knows.

```
volumetricLight/
├── VolumetricLightPass.ts        the pass. three + postprocessing only.
├── VolumetricLightFilter.tsx     the same thing with a Leva panel (React)
└── glsl/volumetricLight.ts       both shaders
```

## Use

Inside the composer from `@react-three/postprocessing`, **early** — see the
warning below, which is about the depth buffer and not about taste:

```tsx
<PostProcessing folder="Grass Postprocessing">
  <HeightFogFilter folder="Grass Fog" />
  <VolumetricLightFilter folder="Grass God Rays" sunDiscPosRef={sunPosRef} />
</PostProcessing>
```

`sunDiscPosRef` is the same ref `SkyDome` writes its disc **position** into:

```tsx
const sunPosRef = useRef(new THREE.Vector3(0, 1, 0));
<SkyDome moonPosRef={sunPosRef} />
```

Use `moonPosRef`, not `moonDirRef`. The dome is centred on the camera *lifted by
its Y offset*, so the disc hangs off that centre — projecting the bare direction
from the camera puts the origin of the shafts about 12° from where the sun is
actually drawn, at this scene's dome offset. `SkyDome` has already resolved it.

Without React:

```ts
const rays = new VolumetricLightPass({ intensity: 0.6 });
rays.sceneCamera = camera;
composer.addPass(rays);
// every frame:
rays.sunWorldPosition.copy(sunDiscPosition);
rays.time = clock.elapsedTime;
```

## How it works

Each pixel marches a short way **toward the sun's pixel**, asking at every step
whether light is getting through there:

```
pixel ──► ──► ──► ──► ☀
```

A pixel whose line to the sun crosses a trunk collects nothing and stays dark.
One that looks through a gap collects sky the whole way and lights up. That is
the shaft — and it is why the effect needs no volume, no shadow map and no
second render of the scene.

The step length is a fraction of *that pixel's own* distance to the sun, so
every pixel covers its whole line in the same number of steps and the fan stays
coherent across the frame.

Two shaders, and the split is what makes it affordable:

| pass | resolution | what it does |
| ---- | ---------- | ------------ |
| mask | half       | colour + depth → "light gets through here", in one image |
| rays | full       | the march, sampling only that small target |

One fetch per step instead of two, out of a texture small enough to stay in
cache. The downsample also softens the mask, which shafts want anyway — full
resolution mostly buys aliasing.

The mask target is **half-float**. In a bloom chain the input buffer is HDR, and
an 8-bit target would clip the sun to white before the march ever saw it,
throwing away exactly the brightness that makes a shaft a shaft.

Sky is `depth >= 0.99999`, not "far away": a depth buffer is violently
non-linear, and at near 0.1 / far 3000 a fragment 1000 units out already sits at
0.99993. A looser cut hands the shafts straight through the far half of the
level. The sky dome writes no depth at all (`depthWrite: false` — it is a
backdrop), so it lands on the cleared value correctly, which is the whole
premise.

## ⚠ Put it early in the composer

`postprocessing` attaches the scene's depth texture to the composer's **initial
input buffer**, and every pass with `needsSwap` flips input and output. A few
passes in, the buffer holding that attachment gets used as a render target and
cleared; depth then reads back as 1.0, which this shader interprets as *open sky
everywhere*.

The failure is silent and almost convincing: shafts still appear, they just stop
being occluded, so the canopy no longer casts them and the frame washes out
evenly. If the rays refuse to be blocked by anything, this is why — move the
pass earlier, do not touch the sky threshold.

## Knobs that matter

| control             | what it does |
| ------------------- | ------------ |
| **Intensity**       | master. 0 is off and skips both draws. |
| **Length**          | how far along the pixel→sun line the march walks. Below 1 the shafts stop short of the disc and read as separate beams; at 1 they converge into it and the sun becomes a star. |
| **Falloff**         | per-step decay — what makes a shaft *fade* along itself instead of ending where the march ran out of steps. |
| **Reach**           | distance from the disc, in screen heights, at which the shafts are gone. The default sits just off-frame, i.e. does nothing until you bring it down. |
| **Light Threshold** | what counts as a light source. The sky beside a low sun is far brighter than the sky behind the camera, so this is the difference between rays that radiate from the disc and a uniform wash off the whole dome. It is also what stops a **night** sky from throwing daylight shafts, with nothing having to switch the effect off per preset. |
| **Sky Only**        | 1 = only depth-cleared pixels emit (the physical case). Lower it and bright geometry starts streaking too — a lantern, a fire, a specular hit. Also the fastest way to make this look wrong. |
| **Dust → Amount**   | breaks the fan into separate beams. At 0 the shafts are a perfectly even radial blur, which is the tell that gives a screen-space effect away — real shafts are uneven because the air is. |
| **Samples**         | quality only. The march is normalised by the weights it used, so this changes how smooth the shafts are, never how bright. |

## What it cannot do

Everything here lives in screen space, which buys the whole effect for two
draws and costs three things:

- **The sun has to be on screen.** Behind the camera the projected disc is its
  own mirror image and the fan would run backwards, so the pass hard-cuts there;
  off the sides it fades over a generous margin instead.
- **Shafts only exist where the sky does.** Light coming through a window from a
  sun that is out of frame has nothing to march toward.
- **Anything occluding is a hard edge.** The mask is binary per pixel, so a
  half-transparent leaf blocks like a wall. At the softness these shafts run at,
  it does not read — but it is why the mask is deliberately downsampled rather
  than sharpened.
