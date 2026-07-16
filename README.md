# Stylized Components

A growing collection of real-time, anime-inspired rendering systems for the web, built with Next.js, Three.js and React Three Fiber.
Each one is a **self-contained, reusable component** written in custom GLSL — drop it into your own scene and drive it from Leva. No baked textures, no black boxes.

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)
![Three.js](https://img.shields.io/badge/Three.js-0.182-black?style=flat-square&logo=three.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)

| Demo | Route | Component | Breakdown |
|---|---|---|---|
| 🌊 **Water — Anime Style** | `/water` | [`WaterFloor`](src/components/WaterFloor) — cel-shaded water, ripples, GPU wave simulation | [▶ YouTube](https://youtu.be/v5YoO8gPYPQ) |
| 🌿 **Stylized Grass** | `/grass` | [`GrassField`](src/components/GrassField) — instanced grass + flowers, dirt blending, trampling | [▶ YouTube](https://www.youtube.com/watch?v=Pqyu7-DDmOM) |

The index page (`/`) lists the demos.

---

## 📽 Demos

### 🌊 Water — Anime Style

https://github.com/user-attachments/assets/ed8cb44d-d290-493c-b0d2-8f48d6580571

### 🌿 Stylized Grass

<!-- To make this play inline on GitHub, drag public/assets/demos/demo-grass.mp4
     into any issue/PR comment box, copy the https://github.com/user-attachments/…
     URL it generates, and paste it here on its own line (like the water clip
     above). A raw.githubusercontent link will NOT play — GitHub serves .mp4 from
     raw as a download, not as video. -->



https://github.com/user-attachments/assets/57236730-37cc-46cb-bc11-69474fad6fd1



Both clips live in the repo under [`public/assets/demos`](public/assets/demos) — the same footage the landing page plays behind its cards.

---

## 🌊 WaterFloor System

The core of this project is the `WaterFloor` component — a modular, layered water rendering system composed of several independent passes that work together to produce the final anime water look.

### Architecture

```
src/components/WaterFloor/
├── index.tsx                        # Main water surface (Voronoi cel-shading + ripple rings)
├── useWaterRipple.ts                # Hook — attach to any object to emit water ripples
├── shaders/                         # WaterFloor GLSL shaders
├── utils/controls.ts                # Leva GUI controls
├── stores/
│   ├── rippleStore.ts               # Singleton — ripple event bus between components
│   └── dragonBallsStore.ts          # Singleton — shared transform state
├── models/
│   ├── DragonBalls/                 # Glass sphere model with custom water-line shader
│   └── Feather/                     # Feather model with bobbing animation + ripples
└── components/
    ├── SeabedFloor/                 # Animated Voronoi seabed (parallax depth layer)
    ├── ShadowCatcher/               # Receives shadows on the seabed plane
    ├── WaterSparkles/               # Procedural 4-pointed star particles on the surface
    ├── WaterDepthIntersection/      # Screen-space depth intersection glow
    └── WaterWaveSimulation/         # PDE-based ping-pong wave simulation
```

---

### Rendering Passes

#### 1. Seabed Floor (`SeabedFloor`)
An animated Voronoi pattern rendered below the water surface, visible through the transparent deep-color areas of the water. Slower cell movement than the surface creates a parallax depth illusion.

#### 2. Water Surface (`WaterFloor`)
Cel-shaded water using a **Voronoi F1 − SmoothF1** subtraction, replicating the Blender node graph approach in GLSL. World-space XZ coordinates keep the pattern anchored regardless of camera movement.

Features:
- 3-stop color ramp (deep → mid → highlight)
- Animated cell positions with noise-based UV distortion
- Hard-edged anime ripple rings driven by `rippleStore`
- Distance fade for infinite-floor look

#### 3. Water Depth Intersection (`WaterDepthIntersection`)
Screen-space depth comparison technique. The DragonBalls geometry is rendered into a depth-only render target each frame. A fullscreen plane at the water surface compares its own depth against the scene depth to detect geometry crossing the water plane, drawing:
- A sharp white silhouette line at the exact intersection
- A soft blue halo glow around it

DPR-aware: uses physical pixel dimensions so the effect stays aligned at any device pixel ratio.

#### 4. Wave Simulation (`WaterWaveSimulation`)
A three-pass GPU wave simulation per frame:

1. **Injection pass** — top-down orthographic render of the DragonBalls geometry clipped to a thin band around the water surface. Produces the exact waterline shape in simulation UV space.
2. **Wave update pass** (ping-pong) — runs the 2D wave PDE each frame:
   `h_next = 2·h_cur − h_prev + c²·∇²h`
   Absorbing boundaries prevent edge reflections.
3. **Display pass** — computes gradient magnitude of the height map; high gradient = ring edge, rendered as an additive overlay.

#### 5. Water Sparkles (`WaterSparkles`)
GPU particle system using `gl_PointCoord` to draw procedural 4-pointed star shapes — no textures required. Each particle fades in/out over its lifetime using a sine curve.

#### 6. Ripple System (`useWaterRipple`)
A composable hook that can be attached to any R3F object. Emits ripple events to `rippleStore` when the object enters the water (entry splash) and periodically while submerged. The water surface shader reads these events and renders concentric anime-style rings.

---

## 🌿 GrassField System

The `/grass` route showcases `GrassField` — a stylized grass system that takes a GLB and turns it into a wind-animated field. It rewires the model **by mesh/material name**, so using your own model means passing names, not editing code.

```tsx
import GrassField from "@/components/GrassField";

<Canvas shadows={{ type: PCFSoftShadowMap }}>
  <directionalLight castShadow position={[-9, 4, -0.5]} />
  <GrassField />
</Canvas>
```

### Architecture

```
src/components/GrassField/
├── index.tsx              # Loads the GLB, rewires it, syncs uniforms each frame
├── uniforms.ts            # Every uniform in the field, in a single shared bag
├── presets.ts             # Named looks (Spring, Autumn…) — pushed into the Leva panel
├── shaders/               # Raw GLSL, injected via onBeforeCompile
│   ├── groundMask.ts      # Procedural dirt mask — the shared source of truth
│   ├── grassBlade.ts      # Wind, dirt shortening, rock trampling, per-blade shadow
│   └── flower.ts          # Wind + palette lookup + dirt culling
├── materials/             # One factory per material
│   ├── bladeMaterial.ts   # Blades (Lambert + injected GLSL)
│   ├── groundMaterial.ts  # Ground: grass tint, dirt patches, fake relief
│   ├── flowerMaterial.ts  # Flowers + their custom depth material for shadows
│   ├── pineLeafMaterial.ts# Repaints foliage RGB, keeps the texture's alpha
│   └── barkMaterial.ts    # Bark color + AO + height, tint-able
└── utils/
    ├── scatter.ts         # Area-weighted placement of blades and flowers
    └── controls.ts        # Leva panels
```

### Features

#### Instanced blades & flowers
Both are scattered by **area-weighted sampling** of the ground mesh's triangles: pick a triangle proportional to its area, then a uniform point inside it. Every instance lands *on* the surface, so `density` means exactly what it says — instances per world unit². Placement is seeded, so the field is identical on every reload.

Flowers are **cross-billboards** (two quads 90° apart) with the petal shape cut out of an alpha mask.

#### Ground colormap blending
A procedural dirt mask in world XZ, sampled by the ground, the blades **and** the flowers through the very same `groundDirt()` function. That shared source of truth is the whole trick: the ground paints the earth, the blades standing on it shrink and take its color, and the flowers are culled from it — so the grass *thins out* into bare earth instead of ending at a hard line.

#### Rock trampling
Rocks are handed to the blade shader as world-space spheres. Blades inside one are pressed flat **and splayed outward** — bending on top of flattening is what makes it read as trampled rather than merely mown.

#### Translucency (subsurface back-light)
An additive back-scatter lobe: blades glow when the camera looks *into* the sun through them, strongest at the thin tips and on blades edge-on to the light. Shadowed blades transmit nothing, so the glow never leaks into shadow.

#### Per-blade shadows
Three resolves shadows per fragment, which leaves a blade half-lit wherever a shadow edge crosses it — drawing a hard straight line across the field. The blade shader instead resolves **one shadow sample per blade**, so each blade is entirely in or out of shadow and the shadow's edge becomes the grass's own jagged silhouette.

#### Shadow-casting flowers
A flower is a quad with its shape cut out by a mask, and Three's shadow pass knows nothing about that mask or about the wind. Without a `customDepthMaterial` each flower would cast the shadow of a **static rectangle**; the depth material repeats both the discard and the wind, so the shadow has a flower's shape and sways with it.

#### Season presets
Named looks (`Spring`, `Autumn`, …) live in `presets.ts` and are switchable from the overlay. A preset names only the values it changes and pushes them into the Leva panel, so it's a starting point, not a lock — everything stays editable afterwards.

#### Sky presets
The scene ships with a `SkyDome` (procedural gradient, sun/moon, FBM clouds, stars, aurora). Switching Sky Mode drives the scene's lighting and a full-screen color filter, so the whole field takes on the mood of the selected sky.

---

## 🛠 Tech Stack

| | |
|---|---|
| **Framework** | Next.js 15 (App Router) |
| **3D / WebGL** | Three.js, React Three Fiber, Drei |
| **Shaders** | Custom GLSL — Voronoi, Fresnel, PDE wave, depth intersection, FBM noise, instanced grass |
| **Animation** | GSAP |
| **GUI** | Leva |
| **Styling** | Tailwind CSS 4 |
| **Language** | TypeScript |

---

## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/cortiz2894/stylized-components.git

cd stylized-components

pnpm install

pnpm dev
```

- [http://localhost:3000](http://localhost:3000) — the demo index
- [http://localhost:3000/water](http://localhost:3000/water) — the **water** scene
- [http://localhost:3000/grass](http://localhost:3000/grass) — the **grass** scene

Each scene exposes its full parameter set through Leva (toggle the panel with the sliders button, bottom right).

---

## 👨‍💻 Author

**Christian Ortiz** — Creative Developer

## 🔗 Links

- **Portfolio:** [cortiz.dev](https://cortiz.dev)
- **YouTube:** [@cortizdev](https://youtube.com/@cortizdev)
- **X (Twitter):** [@cortiz2894](https://twitter.com/cortiz2894)
- **LinkedIn:** [Christian Daniel Ortiz](https://linkedin.com/in/christian-daniel-ortiz)

📬 For inquiries or collaborations: **cortiz2894@gmail.com**

---

⭐ If you found this useful, consider subscribing to my [YouTube channel](https://youtube.com/@cortizdev) for more creative development content!
