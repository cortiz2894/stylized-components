# GrassField

Stylized, wind-animated grass for React Three Fiber. Drop it a GLB and it turns
the model into a grass field: instanced blades and flowers scattered over a
ground mesh, procedural dirt patches, trampling around rocks, backlit
translucency, and repainted foliage/bark.

```tsx
import GrassField from "@/components/grassField";

<Canvas shadows={{ type: PCFSoftShadowMap }} camera={{ far: 3000 }}>
  <ambientLight />
  <directionalLight castShadow position={[-9, 4, -0.5]} />
  <GrassField />
</Canvas>;
```

A `directionalLight` is required: the field mirrors it into the blade shader to
drive translucency, and it is what casts the shadows the blades receive.

## Using your own model

The component rewires the GLB **by name** — that is the whole integration
contract. Either name things to match the defaults or pass your own:

| Prop            | Default                            | What it does                                            |
| --------------- | ---------------------------------- | ------------------------------------------------------- |
| `url`           | `/assets/grass-scene.glb`          | The model to dress                                       |
| `groundMesh`    | `grass-floor`                      | Mesh that blades and flowers are scattered on            |
| `rockMaterial`  | `RocksStylized_M`                  | Meshes that press the grass down around them             |
| `trunkMaterial` | `Material.011`                     | Meshes repainted with the bark maps                      |
| `leafMaterial`  | `2237f4d6…`                        | Foliage: RGB is replaced, the texture's alpha is kept    |

Anything not matched is left as authored. Textures (`barkTextures`,
`flowerTexturesA/B`) are props too.

After swapping the model, the two settings to revisit first are **blade density**
(it is per world unit², so it depends on how big your ground mesh is) and **blade
length**.

## Presets

`presets.ts` holds named looks (`Spring`, `Autumn`, …). Pass one with the
`preset` prop — the demo page wires it to a picker in the overlay:

```tsx
<GrassField preset="autumn" />
```

A preset only names the values it changes, and applying one pushes them into the
Leva panel, where they stay editable. They are applied on top of the **default**,
never on top of the previous preset — otherwise the fields a preset stays silent
about would keep whatever the last one left there, and switching A → B → A
wouldn't land back on A.

Only live uniforms belong in a preset. Anything marked `(rebuilds)` in the panel
would respawn every instance on each switch.

## Layout

```
index.tsx          the component: loads the GLB, rewires it, syncs uniforms
uniforms.ts        every uniform in the field, in one bag
shaders/           raw GLSL, injected via onBeforeCompile
materials/         one factory per material (blade, ground, flower, leaf, bark)
utils/scatter.ts   area-weighted placement of blades and flowers
utils/controls.ts  all the Leva panels
```

## Things worth knowing before you change it

**One uniform bag, shared on purpose.** The blades and the ground read the same
`uGrassBottom`, `uBrightness` and dirt uniforms. That's what makes a blade's base
and the soil it grows out of resolve to *exactly* the same color, and what makes
both agree on where the dirt is. Split them and the bases start banding against
the ground.

**The dirt mask is one function, called from three shaders.** `groundDirt()` is
read by the ground (which paints the earth), the blades (which shrink and take
its color) and the flowers (which are culled off it — flowers grow in grass, not
on bare soil). All three sample it on the GPU rather than filtering on the CPU,
which keeps the Coverage slider live: dragging it repaints the ground, reshapes
the grass and moves the flowers with no instance respawn.

**Everything is a uniform except geometry.** Colors, wind, dirt, trampling and
translucency are live — dragging them recompiles nothing. Only the params marked
`(rebuilds)` in Leva (counts and sizes) respawn instances.

**Blades are lit with a fake normal.** Every blade's shading normal is forced to
`+Y`, so lighting depends on *where* a blade stands, not how it happens to be
rotated — otherwise the field shimmers. The ground does the same, or the same
color would come out at a different NdotL. Translucency needs the true facing
direction, so the vertex shader passes it separately as `vBladeN`.

**Shadows are sampled once per blade.** Three resolves shadows per fragment,
which would leave a blade half-lit where a shadow edge crosses it, and draw a
hard straight line across the field. The blade shader overrides `worldPosition`
with a point that is constant for the whole blade, so each blade is entirely in
or out of shadow and the shadow's edge becomes the grass's own silhouette.

**Flowers need a custom depth material.** They are quads with the petal shape cut
out by an alpha mask. Three's shadow pass knows nothing about that mask or about
the wind, so without `customDepthMaterial` every flower would cast the shadow of
a static rectangle. The wind GLSL is shared between the visible and depth
materials for exactly this reason — if they drift apart, shadows desync.

**Foliage keeps its texture.** Only the RGB is repainted; the alpha stays bound,
because that is what cuts out the leaf silhouette *and* what Three uses to derive
the shadow silhouette.

**Anything that moves in a vertex shader needs a depth material.** Blades,
flowers and canopies are all displaced by the wind, and Three's shadow pass runs
its own depth material that knows nothing about that displacement — so a swaying
thing would cast a perfectly still shadow. Flowers and canopies therefore ship a
`customDepthMaterial` that replays the same wind GLSL (shared from `shaders/`,
never copy-pasted, precisely so the two can't drift apart). Blades are the
exception: they don't cast at all.
