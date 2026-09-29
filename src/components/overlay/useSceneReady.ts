"use client";

import { useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";

/**
 * True once the scene's assets have finished arriving.
 *
 * Read from three's loading manager rather than from a Suspense boundary,
 * because the models that take the time are each behind their OWN boundary
 * further down the tree — an outer one resolves instantly and would report a
 * scene that has not started loading anything yet. The manager sees every
 * loader on the page regardless of where it sits.
 *
 * Two conditions, and the second is the subtle one. `active` is false both when
 * everything has loaded AND in the render or two before any loader has
 * registered, so on its own it reports "ready" immediately. `total` counts what
 * the manager has been handed: above zero, something did start, so the absence
 * of activity now means finished rather than not begun.
 *
 * The grace timer covers the remaining case — a scene with genuinely nothing to
 * load, where `total` never leaves zero and the first condition would otherwise
 * never be satisfied.
 *
 * Deliberately not latched: it reports what the manager is doing now, so a load
 * that starts later reads as loading again. Every asset in these scenes is
 * requested at mount, and the one thing that arrives later — a GLB the user
 * drops — is tracked separately by the page and wants the overlay anyway.
 */
export function useSceneReady(graceMs = 400): boolean {
  const { active, total } = useProgress();
  const [graceOver, setGraceOver] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), graceMs);
    return () => clearTimeout(timer);
  }, [graceMs]);

  return !active && (total > 0 || graceOver);
}
