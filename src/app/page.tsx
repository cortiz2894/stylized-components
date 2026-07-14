import Link from "next/link";
import styles from "./home.module.css";

interface Demo {
  href: string;
  index: string;
  title: string;
  description: string;
  video: string;
  tags: string[];
  glyph: React.ReactNode;
}

const DEMOS: Demo[] = [
  {
    href: "/water",
    index: "01",
    title: "Water — Anime Style",
    video: "/assets/demos/demo-water.mp4",
    description:
      "Cel-shaded water built on a Voronoi ramp, with hard-edged ripple rings, a GPU wave simulation and a screen-space intersection glow where objects break the surface.",
    tags: ["Voronoi", "PDE Wave Sim", "Depth Intersection", "Ripples"],
    glyph: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M1 6c2.5-2.4 4-2.4 6.5 0S13.5 8.4 17 6" />
        <path d="M1 11c2.5-2.4 4-2.4 6.5 0s5.5 2.4 9.5 0" />
      </svg>
    ),
  },
  {
    href: "/grass",
    index: "02",
    title: "Stylized Grass",
    video: "/assets/demos/demo-grass.mp4",
    description:
      "A wind-animated field of instanced blades and flowers, with procedural dirt blending, grass trampled flat around rocks, backlit translucency and per-blade shadows.",
    tags: ["Instancing", "Colormap Blend", "Translucency", "Sky Presets"],
    glyph: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M9 16V7" />
        <path d="M9 10C7 9 5.5 6.5 5.5 3.5 7.5 4.5 9 7 9 10Z" />
        <path d="M9 11c2-1 3.5-3.5 3.5-6.5C10.5 5.5 9 8 9 11Z" />
        <path d="M2 16h14" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <span className={styles.cornerTL} />
      <span className={styles.cornerTR} />

      <div className={styles.inner}>
        <header>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowRule} />
            <span>Open source / React Three Fiber</span>
          </div>

          <h1 className={styles.title}>
            Stylized Components
            <br />
            <span className={styles.titleDim}>by Cortiz</span>
          </h1>

          <p className={styles.lead}>
            A growing collection of real-time, anime-inspired rendering systems for
            the web — each one a self-contained component you can drop into your own
            scene and drive from a control panel. Written in custom GLSL, no baked
            textures, no black boxes.
          </p>
        </header>

        <div className={styles.grid}>
          {DEMOS.map((demo) => (
            <Link key={demo.href} href={demo.href} className={styles.card}>
              {/* Muted + loop + playsInline is what lets this autoplay without
                  any client JS, so the page stays a server component. */}
              <video
                className={styles.media}
                src={demo.video}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-hidden
              />
              {/* Scrim: the copy has to stay readable over whatever frame the
                  video happens to be on. */}
              <span className={styles.scrim} />

              <span className={styles.index}>{demo.index}</span>

              <span className={styles.glyph}>{demo.glyph}</span>

              <h2 className={styles.cardTitle}>{demo.title}</h2>
              <p className={styles.cardText}>{demo.description}</p>

              <span className={styles.rule} />

              <div className={styles.tags}>
                {demo.tags.map((tag) => (
                  <span key={tag} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>

              <div className={styles.footerRow}>
                <span className={styles.enter}>View demo</span>
                <svg
                  className={styles.arrow}
                  width="22"
                  height="10"
                  viewBox="0 0 22 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                >
                  <path d="M0 5h20M16 1l4 4-4 4" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
