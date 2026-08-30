import { useCallback, useEffect, useState } from "react";

/**
 * Which blocks of a statistics tab a reader wants to see.
 *
 * Asked for by a tester who records no prices and had a cost block on every
 * screen (Alex, 2026-08-29). The general shape rather than a "hide costs"
 * switch, because the same is true of ratings for someone who never rates, and
 * of seats for someone who flies once a year.
 *
 * EVERYTHING IS VISIBLE UNTIL SOMEONE SAYS OTHERWISE, and only the HIDDEN keys
 * are stored. That is what lets a new section appear for existing users: a
 * stored allow-list would silently swallow every block added after the day it
 * was written, and nobody would ever find out why their page stopped growing.
 *
 * Per browser, like the map's appearance. It is a reading preference rather
 * than data, and one that should not follow someone onto a device where the
 * screen is a different size.
 */
const KEY_PREFIX = "stats.hiddenSections.";

export interface SectionVisibility {
  /** False only for a section the reader has explicitly switched off. */
  isVisible: (section: string) => boolean;
  toggle: (section: string) => void;
  /** Back to showing everything. */
  reset: () => void;
  hiddenCount: number;
}

function load(tab: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${tab}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Unreadable storage is not a reason to hide anything.
    return [];
  }
}

export function useSectionVisibility(tab: string): SectionVisibility {
  const [hidden, setHidden] = useState<string[]>(() => load(tab));

  // Re-read when the tab changes: each tab keeps its own list, and a reader who
  // hid costs on flights has said nothing about cruises.
  useEffect(() => {
    setHidden(load(tab));
  }, [tab]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${KEY_PREFIX}${tab}`, JSON.stringify(hidden));
    } catch {
      /* private mode or blocked site data — the choice does not survive a reload */
    }
  }, [tab, hidden]);

  const isVisible = useCallback((section: string) => !hidden.includes(section), [hidden]);

  const toggle = useCallback((section: string) => {
    setHidden((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    );
  }, []);

  const reset = useCallback(() => setHidden([]), []);

  return { isVisible, toggle, reset, hiddenCount: hidden.length };
}
