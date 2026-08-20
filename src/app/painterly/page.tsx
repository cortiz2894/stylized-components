import type { Metadata } from "next";
import PainterlyStarter from "@/components/painterlyStarter/PainterlyStarter";

// Companion to the video: the filter on the smallest scene that shows it, with
// the debug views switched on. Deliberately NOT in the carousel — the sitemap
// is generated from that catalogue, so staying out of it keeps this page off
// the sitemap too, and `robots` keeps it out of the index either way.
export const metadata: Metadata = {
  title: "Painterly Starter — Anisotropic Kuwahara",
  description:
    "Minimal reference scene for the painterly (anisotropic Kuwahara) post-processing filter.",
  robots: { index: false, follow: false },
};

export default function PainterlyStarterPage() {
  return <PainterlyStarter />;
}
