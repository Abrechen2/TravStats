import { useEffect, useState } from "react";

/**
 * How close to the end of the document still counts as "at the bottom".
 *
 * Sub-pixel layout, browser zoom and a fractional device pixel ratio leave a
 * gap that never reaches exactly zero, so an equality test would mark the
 * last section only by accident.
 */
const BOTTOM_EPSILON_PX = 4;

/**
 * Has the page been scrolled as far as it goes?
 *
 * The scroll container is the window: `AppShell` lays out `min-h-screen` with
 * a plain `<main>` and no `overflow` of its own, so the document scrolls and
 * `scrollY` is the measure. A page that is not taller than the viewport has
 * no bottom to reach — saying "yes" there would pin the index to the last
 * entry on every short page, so it answers `false` instead.
 */
function isScrolledToEnd(): boolean {
  if (typeof window === "undefined") return false;
  const doc = document.documentElement;
  if (!doc) return false;
  const viewport = window.innerHeight;
  const total = doc.scrollHeight;
  if (total <= viewport + BOTTOM_EPSILON_PX) return false;
  return window.scrollY + viewport >= total - BOTTOM_EPSILON_PX;
}

/**
 * Which of the given section ids is on screen, for an index column to mark.
 *
 * An IntersectionObserver over the section landmarks (`${idPrefix}-${id}`):
 * the topmost section that reaches the upper third of the viewport wins.
 * Absent in jsdom, where the index simply marks nothing — the same
 * degradation SettingsPage always used, and where this hook started life as
 * a private helper. Round 4 gave AdminPage the identical "one page, anchor
 * jumps" treatment, so the hook moved here rather than being copied a
 * second time with a second, sure-to-drift `rootMargin`.
 *
 * `idPrefix` is the landmark's namespace ("settings" -> `settings-<id>`,
 * "admin" -> `admin-<id>`) — the two pages' ids are otherwise
 * indistinguishable ("backups", "logging", … exist on both).
 *
 * **The bottom of the document marks the last section, whatever the observer
 * says.** A short last section can never push its own top into the upper
 * third, so the observer had no way to name it and its menu entry stayed
 * dead — the tester could not open "Über TravStats" at all. SettingsPage
 * answered that with an empty spacer roughly one viewport tall under the
 * last card, which bought the scroll room at the price of a blank screen the
 * tester then reported as ugly. The spacer was a workaround for a rule this
 * scroll-spy lacked: once the page is scrolled as far as it goes, the reader
 * is looking at the end of the document, so the last section is the answer
 * regardless of geometry. With the rule here, every page that uses the hook
 * gets it, and no page needs a tail.
 */
export function useSectionInView(ids: readonly string[], idPrefix: string): string | null {
  const [observed, setObserved] = useState<string | null>(ids[0] ?? null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const prefix = `${idPrefix}-`;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.startsWith(prefix)
            ? entry.target.id.slice(prefix.length)
            : entry.target.id;
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setObserved(first);
        // An intersection change is also the cheapest signal that the page's
        // height moved (a lazy section mounting, a card expanding), which a
        // scroll event alone would not report.
        setAtEnd(isScrolledToEnd());
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(`${prefix}${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids, idPrefix]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const measure = (): void => setAtEnd(isScrolledToEnd());
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const last = ids.length > 0 ? ids[ids.length - 1] : null;
  return atEnd && last ? last : observed;
}
