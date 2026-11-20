import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Brings the element named by the URL fragment into view once `ready` — the
 * trip map's info card links to `…?tab=timeline#timeline-<event id>`, and a
 * browser only scrolls to a fragment that already exists when the page loads.
 * A fragment with no element is left alone: the page is simply where it is.
 */
export function useScrollToHash(ready: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || hash.length < 2) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    target?.scrollIntoView({ block: "center" });
  }, [ready, hash]);
}
