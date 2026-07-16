import Link from "next/link";
import styles from "./home.module.css";

const GITHUB_REPO = "https://github.com/cortiz2894/stylized-components";
const YOUTUBE_CHANNEL = "https://www.youtube.com/@cortizdev?sub_confirmation=1";

interface Demo {
  href: string;
  index: string;
  title: string;
  description: string;
  video: string;
  /** Breakdown video for this component. */
  tutorial: string;
  tags: string[];
  glyph: React.ReactNode;
}

const DEMOS: Demo[] = [
  {
    href: "/water",
    index: "01",
    title: "Water — Anime Style",
    video: "/assets/demos/demo-water.mp4",
    tutorial: "https://youtu.be/v5YoO8gPYPQ",
    description:
      "Cel-shaded water built on a Voronoi ramp, with hard-edged ripple rings, a GPU wave simulation and a screen-space intersection glow where objects break the surface.",
    tags: ["Voronoi", "PDE Wave Sim", "Depth Intersection", "Ripples"],
    glyph: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
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
    tutorial: "https://www.youtube.com/watch?v=Pqyu7-DDmOM",
    description:
      "A wind-animated field of instanced blades and flowers, with procedural dirt blending, grass trampled flat around rocks, backlit translucency and per-blade shadows.",
    tags: ["Instancing", "Colormap Blend", "Translucency", "Sky Presets"],
    glyph: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
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

          {/* <p className={styles.lead}>
             Written in custom
            GLSL, no baked textures, no black boxes.
          </p> */}

          <p className={styles.lead}>
            A growing collection of real-time, anime-inspired rendering systems
            for the web — each one a self-contained component you can drop into
            your own scene and drive from a control panel.
            <br /> <br /> All of it is free and open source. If it helps you,
            the best way to support the work is to{" "}
            <a
              className={styles.inlineLink}
              href={YOUTUBE_CHANNEL}
              target="_blank"
              rel="noopener noreferrer"
            >
              subscribe on YouTube
            </a>{" "}
            — it costs nothing — and follow along on the socials below.
          </p>
        </header>

        <div className={styles.grid}>
          {DEMOS.map((demo) => (
            // An <article>, not a <Link>: the card now holds its own links, and
            // an anchor can't legally nest inside another anchor.
            <article key={demo.href} className={styles.card}>
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

              {/* <span className={styles.glyph}>{demo.glyph}</span> */}

              <h2 className={styles.cardTitle}>{demo.title}</h2>
              <p className={styles.cardText}>{demo.description}</p>

              {/* <span className={styles.rule} /> */}

              <div className={styles.actions}>
                <Link href={demo.href} className={styles.actionPrimary}>
                  View demo
                  <svg
                    className={styles.arrow}
                    width="18"
                    height="10"
                    viewBox="0 0 18 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <path d="M0 5h16M12 1l4 4-4 4" />
                  </svg>
                </Link>

                <a
                  className={styles.action}
                  href={demo.tutorial}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <rect x="1" y="3" width="14" height="10" rx="2.5" />
                    <path
                      d="M6.8 6.2v3.6L10 8z"
                      fill="currentColor"
                      stroke="none"
                    />
                  </svg>
                  Tutorial
                </a>

                <a
                  className={styles.action}
                  href={GITHUB_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 .2a8 8 0 0 0-2.5 15.6c.4.07.55-.17.55-.38v-1.34C3.84 14.5 3.4 13 3.4 13c-.36-.9-.88-1.15-.88-1.15-.72-.5.05-.48.05-.48.8.06 1.22.82 1.22.82.7 1.2 1.85.86 2.3.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.14.46.55.38A8 8 0 0 0 8 .2z" />
                  </svg>
                  GitHub
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
