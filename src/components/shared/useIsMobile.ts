"use client";

import { useEffect, useState } from "react";

/**
 * Must match the breakpoint in HomeCarousel.module.css.
 *
 * The stylesheet moves the copy, the picker and the caption at this width; the
 * ring changes shape and the footer hands its calls to action to the overlay at
 * the same one. Any of them disagreeing about what a small screen is leaves the
 * layout rearranged by halves — the worst version being two components that
 * both think the other is showing the buttons.
 */
export const MOBILE_QUERY = "(max-width: 900px)";

/**
 * Starts false on both server and client, then corrects after mount.
 *
 * Guessing on the server would mean the first client render disagreeing with
 * the HTML it is hydrating — and this decides which elements exist, not just
 * how they look, so that disagreement is a hydration error rather than a
 * repaint. One extra render is the cheaper half of the trade.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const read = () => setIsMobile(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  return isMobile;
}
