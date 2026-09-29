import type { Metadata } from "next";
import styles from "../landing.module.css";
import GodRaysCanvas from "@/components/godRaysScene/GodRaysCanvas";

// A SERVER component, so it can export metadata — the canvas below is its own
// client boundary.
export const metadata: Metadata = {
  title: "God Rays",
  description:
    "An anime classroom at sunset: light cut into shafts by the window frames, marched through the room in world space, a screen-space fan off the sun through the glass, and dust that only shows where the beams catch it.",
};

export default function GodRaysPage() {
  return (
    <div className={styles.page}>
      <GodRaysCanvas />
    </div>
  );
}
