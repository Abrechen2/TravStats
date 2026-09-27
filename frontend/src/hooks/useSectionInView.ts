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
 * Where the reader is reading: just under the sticky header (56 px) and the
 * 16 px each landmark's `scroll-margin-top` leaves above a jumped-to section.
 * A section whose top has passed this line is the one being read.
 */
const READING_LINE_PX = 96;

/**
 * The last section, in document order, whose top has passed the reading
 * line — or the first section while none has. Measured from the landmarks'
 * live positions at the moment of asking.
 */
function sectionAtReadingLine(ids: readonly string[], prefix: string): string | null {
  let current: string | null = ids[0] ?? null;
  for (const id of ids) {
    const el = document.getElementById(`${prefix}${id}`);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= READING_LINE_PX) current = id;
    else break;
  }
  return current;
}

/**
 * Which of the given section ids is being read, for an index column to mark.
 *
 * The section whose top has most recently passed the reading line under the
 * header. It used to be "the first section that intersects the upper third
 * of the viewport", read from IntersectionObserver entries: a short section
 * above the one being read still intersected that band, came first in
 * document order and won — Einstellungen marked "Reisen" while the reader sat
 * in "Bonusprogramme" (acceptance run, 2026-09-26). Positions are now read
 * live on every scroll, resize and intersection change (the last being the
 * cheapest signal that a lazy section changed the page's height).
 *
 * `idPrefix` is the landmark's namespace ("settings" -> `settings-<id>`,
 * "admin" -> `admin-<id>`) — the two pages' ids are otherwise
 * indistinguishable ("backups", "logging", … exist on both).
 *
 * **The bottom of the document marks the last section.** A short last section
 * can never bring its top up to the reading line, so its menu entry would stay
 * dead — the tester could not open "Über TravStats" at all. Once the page is
 * scrolled as far as it goes, the reader is looking at the end of the
 * document, so the last section is the answer regardless of geometry.
 */
export function useSectionInView(ids: readonly string[], idPrefix: string): string | null {
  const [current, setCurrent] = useState<string | null>(ids[0] ?? null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefix = `${idPrefix}-`;
    const measure = (): void => {
      setCurrent(sectionAtReadingLine(ids, prefix));
      setAtEnd(isScrolledToEnd());
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(measure);
      for (const id of ids) {
        const el = document.getElementById(`${prefix}${id}`);
        if (el) observer.observe(el);
      }
    }
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [ids, idPrefix]);

  const last = ids.length > 0 ? ids[ids.length - 1] : null;
  return atEnd && last ? last : current;
}
