import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/** How long a search hit's section stays marked. */
export const HIGHLIGHT_MS = 2400;
/** How long to wait for the section to mount — a page may still be loading. */
export const HIGHLIGHT_WAIT_MS = 10_000;
const POLL_MS = 100;

/**
 * The section a settings search hit just opened, for as long as it stays
 * marked (forgejo#321 prototype: the search highlights and scrolls to the
 * section). The hit passes it as router state, never in the address, so a
 * reload or a shared link does not flash anything.
 *
 * The mark starts when the section is on the page, not when the address
 * changes: Administration shows a loading state first, and a timer started
 * on arrival ran out before the section existed (Codex review).
 */
export function useSearchHighlight(anchorPrefix: "settings" | "admin"): string | null {
  const location = useLocation();
  const raw = (location.state as { highlight?: unknown } | null)?.highlight;
  const requested = typeof raw === "string" ? raw : null;
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!requested) return;
    let fade: ReturnType<typeof setTimeout> | undefined;
    let waited = 0;
    const mark = (el: HTMLElement): void => {
      setActive(requested);
      // The page scrolls to a section its address names; this also covers a
      // hit on the section already open, whose address does not change.
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      fade = setTimeout(() => setActive(null), HIGHLIGHT_MS);
    };
    const find = (): HTMLElement | null => document.getElementById(`${anchorPrefix}-${requested}`);
    const now = find();
    let poll: ReturnType<typeof setInterval> | undefined;
    if (now) mark(now);
    else {
      poll = setInterval(() => {
        waited += POLL_MS;
        const el = find();
        if (el || waited >= HIGHLIGHT_WAIT_MS) clearInterval(poll);
        if (el) mark(el);
      }, POLL_MS);
    }
    return () => {
      clearInterval(poll);
      clearTimeout(fade);
    };
    // `location.key`: the same hit opened twice marks the section twice.
  }, [requested, location.key, anchorPrefix]);

  return active;
}
