"use client";

import { PerformanceMonitor, Stats } from "@react-three/drei";
import { useControls, folder } from "leva";

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive resolution — one policy, shared by every scene on the site.
//
// Frame budget is not a property of the machine, it is a property of the
// machine AND the display: requestAnimationFrame targets the panel's refresh
// rate, so a 120Hz laptop screen asks for a frame every 8.3ms where a 60Hz
// monitor asks every 16.7ms. The same scene on the same computer can make one
// deadline and miss the other. drei's monitor reads the refresh rate and sets
// its targets from it, which is why this is worth having rather than a fixed
// pixel ratio picked on whatever hardware it was tuned on.
//
// The scale only ever goes DOWN from each scene's own ceiling. Whatever pixel
// ratio a scene was tuned at is still what a machine that can afford it gets;
// this is a floor for the ones that cannot, not a second opinion about the look.
// ─────────────────────────────────────────────────────────────────────────────

/** Reduced step. One step, because resizing the drawing buffer costs a hitch of
 *  its own and a scale that keeps hunting is worse than one slightly too low. */
const REDUCED = 0.75;

export interface PerformanceSettings {
  adaptiveRes: boolean;
  showFps: boolean;
}

/**
 * The two controls, in the scene's own Leva folder.
 *
 * `folderName` is per scene because Leva's store is global and keyed by folder
 * plus control name — one shared folder and every scene would be toggling the
 * same switch.
 */
export function usePerformanceControls(
  folderName = "Performance",
): PerformanceSettings {
  return useControls(folderName, {
    Quality: folder(
      {
        adaptiveRes: { value: true, label: "Adaptive Resolution" },
        // Measurement, not decoration: "it feels slower on this screen" is not
        // something anyone can act on, and the two displays that prompted this
        // differ in ways only a number separates.
        showFps: { value: false, label: "Show FPS" },
      },
      { collapsed: true },
    ),
  }) as unknown as PerformanceSettings;
}

/**
 * Drop inside a <Canvas>. Reports a multiplier for the scene's pixel ratio.
 */
export default function AdaptiveResolution({
  settings,
  onScale,
}: {
  settings: PerformanceSettings;
  onScale: (scale: number) => void;
}) {
  return (
    <>
      {settings.adaptiveRes && (
        <PerformanceMonitor
          onDecline={() => onScale(REDUCED)}
          onIncline={() => onScale(1)}
          // After this many swings it stops trying and stays down, rather than
          // oscillating between two resolutions for the rest of the session.
          flipflops={3}
          onFallback={() => onScale(REDUCED)}
        />
      )}
      {settings.showFps && <Stats />}
    </>
  );
}
