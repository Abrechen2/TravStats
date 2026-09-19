import { useEffect, type RefObject } from "react";

/**
 * How long the deep-link aligner (see `useDeepLinkScroll` below) keeps
 * correcting the scroll position after a `?section=` link lands, before it
 * gives up. Exported so `AdminPage.sections.test.tsx` can pin the exact
 * bound rather than a duplicated magic number.
 */
export const DEEP_LINK_ALIGN_BUDGET_MS = 2000;

/** Keys that move the reading position — anything else (Tab, a form key, …)
 *  must not cancel the aligner just because the user pressed something. */
const SCROLL_INTENT_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
]);

/**
 * Scrolls a `?section=` deep link into view once the page has rendered, and
 * keeps correcting that position for as long as the page's layout is still
 * settling around it.
 *
 * Extracted out of `AdminPage.tsx` (which was pushing the 800-line file-size
 * ratchet) — this is the whole of the deep-link scroll behaviour, reusable
 * by anything with the same "one long page, `?section=` anchors into it"
 * shape as `AdminPage`'s general/flight/cruise tabs.
 *
 * ## Wave C finding C1 (independent review, 2026-09-17) and its follow-up
 *
 * Round 1 scrolled once (this hook's first effect) using whatever height
 * every section happened to have at that moment — for a lazy section, only
 * its placeholder until it had been near the viewport — and additionally
 * re-ran the scroll once the TARGET's own `LazySection` reported it had
 * mounted.
 *
 * A browser measurement of round 1 showed it did not actually work:
 * `/admin?section=logging` at 1440x900 landed the target at `top = 3196`
 * with `scrollY = 2786` — nowhere near the ~72px anchor offset. The sections
 * that actually grow past their 240px placeholder are the ones ABOVE the
 * target (they mount as the page scrolls past them and are far taller once
 * real content lands), which pushes the target further down — below the
 * fold, where it never intersects, so it never mounts, so the "wait for
 * target mount" correction never fired at all.
 *
 * Round 2 (this hook's second effect) reacts to the PAGE'S layout changing
 * instead of to one section's mount: a `ResizeObserver` on the sections
 * column re-issues `scrollIntoView` — which already respects each section's
 * own `scrollMarginTop` — whenever ANY section's height changes, for up to
 * `DEEP_LINK_ALIGN_BUDGET_MS` after the deep link lands. It gives up once
 * the budget runs out, and cancels immediately on real user scroll intent
 * (wheel, touch, or a navigation key) so it can never fight the reader — the
 * corrective calls themselves also fire native `scroll` events, so that
 * generic event cannot be the cancel signal.
 *
 * @param containerRef the element whose size the aligner watches — the
 *   column that holds every section, so ANY of them growing is caught.
 * @param loading page's own "still loading" flag — the DOM has no
 *   `admin-<id>` elements yet while this is true (see the first effect).
 * @param deepLinkedSection the `?section=` target, or null if there is none.
 */
export function useDeepLinkScroll(
  containerRef: RefObject<HTMLElement | null>,
  loading: boolean,
  deepLinkedSection: string | null
): void {
  // Keyed on `loading` rather than `[]`: on the very first render the page
  // is still showing its own loading placeholder, so `admin-<id>` does not
  // exist in the DOM yet — an empty dependency array would run this before
  // there was anything to scroll to. A later section jump is handled
  // imperatively (by the page's own `jump` callback) and needs no effect.
  useEffect(() => {
    if (loading || !deepLinkedSection) return;
    const el = document.getElementById(`admin-${deepLinkedSection}`);
    // Feature-checked: jsdom has no layout, so the method is absent there.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [loading, deepLinkedSection]);

  useEffect(() => {
    if (loading || !deepLinkedSection) return;
    const container = containerRef.current;
    const el = document.getElementById(`admin-${deepLinkedSection}`);
    if (!container || !el) return;
    if (typeof el.scrollIntoView !== "function") return;
    // Feature-checked like LazySection's own observer: absent in jsdom.
    if (typeof ResizeObserver === "undefined") return;

    let cancelled = false;
    const deadline = Date.now() + DEEP_LINK_ALIGN_BUDGET_MS;

    const cancel = (): void => {
      if (cancelled) return;
      cancelled = true;
      resizeObserver.disconnect();
      window.clearTimeout(budgetTimer);
      window.removeEventListener("wheel", onUserScrollIntent);
      window.removeEventListener("touchmove", onUserScrollIntent);
      window.removeEventListener("keydown", onKeyScrollIntent);
    };

    const onUserScrollIntent = (): void => cancel();
    const onKeyScrollIntent = (event: KeyboardEvent): void => {
      if (SCROLL_INTENT_KEYS.has(event.key)) cancel();
    };

    const resizeObserver = new ResizeObserver(() => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        cancel();
        return;
      }
      // Instant, not smooth: an animated correction fighting a still-moving
      // layout is exactly the jitter a bounded aligner is meant to avoid.
      el.scrollIntoView({ block: "start", behavior: "auto" });
    });
    resizeObserver.observe(container);

    window.addEventListener("wheel", onUserScrollIntent, { passive: true });
    window.addEventListener("touchmove", onUserScrollIntent, { passive: true });
    window.addEventListener("keydown", onKeyScrollIntent);

    const budgetTimer = window.setTimeout(cancel, DEEP_LINK_ALIGN_BUDGET_MS);

    return cancel;
  }, [loading, deepLinkedSection, containerRef]);
}
