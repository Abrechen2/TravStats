import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { recordNavigation } from "../../lib/navigation/navHistory";
import {
  readScrollPosition,
  saveScrollPosition,
  scrollRestoreBlocked,
} from "../../lib/navigation/scrollMemory";

/**
 * Back is a real Back: the page comes back where the reader left it.
 *
 * Mounted once inside the router. It records the history the app walks (for
 * the in-app back link, `useBackNavigation`) and keeps a scroll position per
 * history entry:
 *
 * - PUSH to another page (a link, opening an entry): to the top, unless a
 *   `#hash` names a spot. A PUSH that only changes the query (a tab kept in
 *   `?tab=`) stays where it is.
 * - REPLACE (a filter, a tab, a page of the list): left alone — it is the same
 *   page, and jumping to the top on every dropdown change would be its own bug.
 * - POP (Back, Forward, reload): the stored position, re-applied until the
 *   page has its data and the document is tall enough, and kept there through
 *   the page transition, until the reader scrolls or the window passes.
 */

/** How long a restored position is held after the page stopped loading. */
const SETTLE_MS = 1200;
/** The hold never outlasts this, whatever the page says. */
const HARD_CAP_MS = 10_000;
const MIN_HOLD_MS = 2500;

export default function NavigationMemory(): null {
  const location = useLocation();
  const kind = useNavigationType();
  const keyRef = useRef(location.key);
  const pathnameRef = useRef<string | null>(null);
  const restoringRef = useRef(false);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const before = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = before;
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let frameKey = keyRef.current;
    const onScroll = (): void => {
      if (restoringRef.current) return;
      // The key at the moment of the scroll, not at the frame: a navigation in
      // between must not file the old page's position under the new entry.
      frameKey = keyRef.current;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!restoringRef.current) saveScrollPosition(frameKey, window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    recordNavigation(
      { key: location.key, pathname: location.pathname, search: location.search },
      kind
    );
    keyRef.current = location.key;
    const samePage = pathnameRef.current === location.pathname;
    pathnameRef.current = location.pathname;

    if (kind === "REPLACE") return;
    if (kind === "PUSH") {
      if (!samePage && !location.hash) window.scrollTo(0, 0);
      return;
    }

    const target = readScrollPosition(location.key);
    if (target === null || target === 0) return;

    restoringRef.current = true;
    const started = performance.now();
    let lastBlocked = started;
    let frame = 0;
    let done = false;

    const stop = (): void => {
      if (done) return;
      done = true;
      restoringRef.current = false;
      if (frame) window.cancelAnimationFrame(frame);
      INPUT_EVENTS.forEach((name) => window.removeEventListener(name, finish));
    };
    const finish = (): void => {
      if (done) return;
      stop();
      saveScrollPosition(location.key, window.scrollY);
    };
    // The reader taking over ends the hold at once.
    INPUT_EVENTS.forEach((name) => window.addEventListener(name, finish, { passive: true }));

    const step = (): void => {
      const now = performance.now();
      const blocked = scrollRestoreBlocked();
      if (blocked) lastBlocked = now;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (!blocked && maxY >= target && Math.abs(window.scrollY - target) > 1) {
        window.scrollTo(0, target);
      }
      const settled = now - started >= MIN_HOLD_MS && now - lastBlocked >= SETTLE_MS;
      if (settled || now - started >= HARD_CAP_MS) {
        // Never reached the full height (the list got shorter meanwhile): as
        // close as the page allows, rather than nowhere.
        if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, Math.min(target, maxY));
        finish();
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    // Leaving mid-hold: stop without saving — the DOM is already the next page's.
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per history entry
  }, [location.key]);

  return null;
}

const INPUT_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;
