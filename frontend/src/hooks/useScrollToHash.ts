import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** How long the arrival outline stays on the row. */
export const HIGHLIGHT_MS = 2500;

/**
 * Brings the element named by the URL fragment into view once `ready`, focuses
 * it and marks it for a moment — the trip map's info card links to
 * `…?tab=timeline#timeline-<event id>`, and a browser only scrolls to a
 * fragment that already exists when the page loads (and says nothing about
 * which row it meant).
 *
 * Focus is what makes it accessible: a screen reader lands on the row, a
 * keyboard continues from it. The mark is an outline plus a background that
 * fades; with reduced motion the outline alone shows, then goes. A fragment
 * with no element is left alone: the page is simply where it is.
 */
export function useScrollToHash(ready: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || hash.length < 2) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.setAttribute("data-arrived", "true");
    const previous = target.style.outline;
    target.style.outline = "2px solid var(--accent)";
    target.style.outlineOffset = "2px";
    const fade =
      !reduced && typeof target.animate === "function"
        ? target.animate(
            [
              { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" },
              { backgroundColor: "transparent" },
            ],
            { duration: HIGHLIGHT_MS, easing: "ease-out" }
          )
        : null;
    const clear = (): void => {
      target.style.outline = previous;
      target.style.outlineOffset = "";
      target.removeAttribute("data-arrived");
    };
    const timer = window.setTimeout(clear, HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(timer);
      fade?.cancel();
      clear();
    };
  }, [ready, hash]);
}
