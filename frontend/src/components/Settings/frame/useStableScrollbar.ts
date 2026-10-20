import { useEffect } from "react";

/**
 * Reserves the scrollbar's width while a settings or admin page is open.
 *
 * Pages differ in length, and a short page has no scrollbar: switching from a
 * long page to a short one moved the whole layout sideways by the bar's width
 * (tester, 2026-10-20). `scrollbar-gutter: stable` on the root keeps the gutter
 * whether or not there is anything to scroll. Set on the root and taken off
 * again on leaving, so the map pages, which own their whole viewport, keep
 * every pixel.
 */
export function useStableScrollbar(): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("scrollbar-gutter");
    root.style.setProperty("scrollbar-gutter", "stable");
    return () => {
      if (previous) root.style.setProperty("scrollbar-gutter", previous);
      else root.style.removeProperty("scrollbar-gutter");
    };
  }, []);
}
