"use client";

import { useControls } from "leva";
import DebugScatter from "./DebugScatter";
import DebugBlade from "./DebugBlade";
import DebugMaskPlane from "./DebugMaskPlane";
import DebugWind from "./DebugWind";

// ─────────────────────────────────────────────────────────────────────────────
// GrassBreakdown — the scene-level breakdown visualisers, in one place.
//
// These four are standalone teaching aids for the breakdown video (placement,
// a single blade, the dirt mask, the wind field). They're NOT part of the field
// itself, so they live here rather than in GrassField, and the whole thing is
// off by default and trivially deletable.
//
// (The other half of the breakdown — the "Debug View" that repaints the blade
// with an intermediate value — lives IN the blade shader, because that's the
// point of it: shaders/debug.ts, driven by the "Grass > Breakdown" controls.)
//
// Usage:
//   const { hideField, view } = useGrassBreakdown();
//   {!hideField && <GrassField />}
//   {view}
// ─────────────────────────────────────────────────────────────────────────────

export function useGrassBreakdown() {
  const { scatter, blade, mask, wind, hideField } = useControls("Breakdown", {
    scatter: { value: false, label: "Scatter (placement)" },
    blade: { value: false, label: "Single Blade" },
    mask: { value: false, label: "Dirt Mask Plane" },
    wind: { value: false, label: "Wind Field" },
    hideField: { value: true, label: "Hide Grass Field" },
  });

  // The wind field is meant to be seen OVER the grass (the bands are the gust the
  // blades lean to), so it doesn't count toward hiding the field.
  const soloVisualiser = scatter || blade || mask;

  return {
    hideField: soloVisualiser && hideField,
    view: (
      <>
        {scatter && <DebugScatter />}
        {blade && <DebugBlade />}
        {mask && <DebugMaskPlane />}
        {wind && <DebugWind />}
      </>
    ),
  };
}
