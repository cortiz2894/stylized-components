"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Immersive mode — hides every piece of UI sitting on top of a demo.
 *
 * The header, the buttons and the switchers are rendered by the page, so those
 * it can just not render. The FOOTER isn't: it lives in the root layout, above
 * the pages, and a page can't unmount it. Hence the body class — `globals.css`
 * hides the footer whenever it's set. Cleaned up on unmount so leaving the demo
 * can't strand the site without a footer.
 */
export function useImmersive() {
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("immersive", immersive);
    return () => document.body.classList.remove("immersive");
  }, [immersive]);

  const toggle = useCallback(() => setImmersive((v) => !v), []);

  // Escape is the reflex for "get me out of fullscreen".
  useEffect(() => {
    if (!immersive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImmersive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [immersive]);

  return { immersive, toggle };
}
