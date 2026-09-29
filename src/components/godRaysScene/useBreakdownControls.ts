"use client";

import { useState } from "react";
import { button, folder, useControls } from "leva";

// ─────────────────────────────────────────────────────────────────────────────
// The breakdown panel: one place to switch what the frame shows while
// recording, so a take is "pick a view, tick a layer" rather than hunting
// through six effect panels.
//
// Called ONCE, in GodRaysCanvas, and handed down as a plain prop — the values
// have to reach both the DOM (the grade and the vignette sit over the canvas)
// and the scene inside it.
// ─────────────────────────────────────────────────────────────────────────────

/** What the whole frame shows. Label → value, as Leva's select takes it. */
export const BREAKDOWN_VIEWS = {
  Final: "final",
  "Albedo (base colour)": "albedo",
  "Clay (lighting only)": "clay",
  "Sun Only (shadow map)": "sun",
  "Screen-Space · Sky Mask": "ssMask",
  "Screen-Space · Rays Only": "ssRays",
  "World-Space · Shafts Only": "shafts",
} as const;

export type BreakdownView =
  (typeof BREAKDOWN_VIEWS)[keyof typeof BREAKDOWN_VIEWS];

export const DUST_VIEWS = {
  Normal: 0,
  "Test Colours (lit / unlit)": 1,
  "No Test (all lit)": 2,
} as const;

export interface BreakdownState {
  view: BreakdownView;
  room: boolean;
  dust: boolean;
  screenSpace: boolean;
  shafts: boolean;
  bloom: boolean;
  grade: boolean;
  dustView: 0 | 1 | 2;
  panes: boolean;
  beams: boolean;
  ray: boolean;
  sunLines: boolean;
  raySamples: number;
  xray: boolean;
  captureId: number;
}

export function useBreakdownControls(): BreakdownState {
  const [captureId, setCaptureId] = useState(0);

  const values = useControls(
    "God Rays Breakdown",
    {
      view: {
        value: "final" as BreakdownView,
        options: BREAKDOWN_VIEWS,
        label: "View",
      },
      Layers: folder(
        {
          room: { value: true, label: "Classroom" },
          dust: { value: true, label: "Dust" },
          screenSpace: { value: true, label: "Screen-Space Rays" },
          // Off: not part of the final look (see GodRaysSceneContent). On
          // for the segment that explains the world-space march.
          shafts: { value: true, label: "Window Shafts" },
          bloom: { value: true, label: "Bloom" },
          grade: { value: true, label: "Grade + Vignette" },
        },
        { collapsed: false },
      ),
      Dust: folder(
        {
          dustView: {
            value: 0 as 0 | 1 | 2,
            options: DUST_VIEWS,
            label: "Dust View",
          },
        },
        { collapsed: true },
      ),
      Helpers: folder(
        {
          panes: { value: false, label: "Window Panes" },
          beams: { value: false, label: "Beam Volumes" },
          xray: { value: true, label: "X-Ray" },
          "Capture Ray": button(() => setCaptureId((n) => n + 1)),
          ray: { value: true, label: "Show Ray" },
          sunLines: { value: true, label: "Sample → Sun Lines" },
          raySamples: {
            value: 16,
            min: 2,
            max: 64,
            step: 1,
            label: "Ray Samples",
          },
        },
        { collapsed: true },
      ),
    },
    { collapsed: true },
  );

  return { ...(values as Omit<BreakdownState, "captureId">), captureId };
}
