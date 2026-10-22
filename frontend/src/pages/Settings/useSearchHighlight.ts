import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/** How long a search hit's section stays marked. */
export const HIGHLIGHT_MS = 2400;

/**
 * The section a settings search hit just opened, for as long as it stays
 * marked (forgejo#321 prototype: the search highlights and scrolls to the
 * section). The hit passes it as router state, never in the address, so a
 * reload or a shared link does not flash anything.
 */
export function useSearchHighlight(anchorPrefix: "settings" | "admin"): string | null {
  const location = useLocation();
  const raw = (location.state as { highlight?: unknown } | null)?.highlight;
  const requested = typeof raw === "string" ? raw : null;
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!requested) return;
    setActive(requested);
    // The page scrolls to a section its address names; this also covers a hit
    // on the section already open, whose address does not change.
    const el = document.getElementById(`${anchorPrefix}-${requested}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    const timer = setTimeout(() => setActive(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
    // `location.key`: the same hit opened twice marks the section twice.
  }, [requested, location.key, anchorPrefix]);

  return active;
}
