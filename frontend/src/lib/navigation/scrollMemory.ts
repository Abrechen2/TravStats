import { useLayoutEffect } from "react";
import { logger } from "../logger";

/**
 * Scroll positions per history entry, and whether the page is ready to take one.
 *
 * The router here is a `BrowserRouter`, not a data router, so React Router's
 * `<ScrollRestoration>` is not available. The browser's own restoration fails
 * on every logbook list for the same reason: it scrolls on `popstate`, while
 * the rows arrive a moment later from the server, so it scrolls a page that is
 * still one skeleton tall and lands at the top (owner report 2026-11-23).
 *
 * Positions are kept in memory and mirrored to sessionStorage, so a reload —
 * which keeps `location.key` — restores too. A page whose content arrives late
 * says so with `useScrollRestoreReady(!loading)`; the restorer waits for every
 * such page to be ready AND for the document to be tall enough.
 */

const STORAGE_KEY = "travstats:scroll-positions";
const MAX_ENTRIES = 100;

let positions: Map<string, number> | null = null;

function load(): Map<string, number> {
  if (positions) return positions;
  positions = new Map();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const pair of parsed) {
          if (
            Array.isArray(pair) &&
            typeof pair[0] === "string" &&
            typeof pair[1] === "number" &&
            Number.isFinite(pair[1])
          ) {
            positions.set(pair[0], pair[1]);
          }
        }
      }
    }
  } catch (err) {
    logger.warn("scrollMemory: unreadable stored positions, starting fresh", err);
  }
  return positions;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const all = [...load().entries()].slice(-MAX_ENTRIES);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (err) {
      // Storage full or blocked: restoring still works within this tab.
      logger.warn("scrollMemory: could not persist scroll positions", err);
    }
  }, 250);
}

export function saveScrollPosition(key: string, y: number): void {
  const map = load();
  map.delete(key); // re-insert so the newest stay inside MAX_ENTRIES
  map.set(key, Math.max(0, Math.round(y)));
  persist();
}

export function readScrollPosition(key: string): number | null {
  return load().get(key) ?? null;
}

// --- readiness --------------------------------------------------------------

let notReady = 0;

/** True while some mounted page still waits for its data. */
export function scrollRestoreBlocked(): boolean {
  return notReady > 0;
}

/**
 * Hold scroll restoration until this page's content is in.
 *
 * A layout effect, so the hold is registered in the same commit that mounts
 * the page — before the restorer, which starts on the next frame, looks.
 */
export function useScrollRestoreReady(ready: boolean): void {
  useLayoutEffect(() => {
    if (ready) return;
    notReady += 1;
    return () => {
      notReady -= 1;
    };
  }, [ready]);
}

/** Test seam. */
export function resetScrollMemory(): void {
  positions = new Map();
  notReady = 0;
}
