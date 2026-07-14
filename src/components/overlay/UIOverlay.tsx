"use client";

import type { SceneMode } from "@/components/playground/SceneContent";
import OverlayHeader from "./OverlayHeader";

interface UIOverlayProps {
  mode: SceneMode;
  title?: string;
  subtitle?: string;
}

export default function UIOverlay({ mode, title, subtitle }: UIOverlayProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <OverlayHeader mode={mode} title={title} subtitle={subtitle} />
    </div>
  );
}
