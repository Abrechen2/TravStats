import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * `#visit-<id>` (a visit date in a place list links here) scrolls that visit's row into view
 * once it is drawn. The browser cannot do it itself: the row appears after the visits load.
 */
export function useScrollToVisit(drawnCount: number): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash.startsWith("#visit-") || drawnCount === 0) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.setAttribute("data-highlighted", "true");
  }, [hash, drawnCount]);
}
