import { useCallback, useEffect, useState } from "react";
import { emitLocalPrefWrite, useWebPrefsEpoch } from "../lib/webPrefs/prefEvents";

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
 * Follows the user across browsers since forgejo#200 (`lib/webPrefs/registry.ts`).
 * It used to be per browser on the argument that a reading preference should
 * not follow someone onto a different screen size — but the reason it exists
 * is the reader's DATA (no prices recorded, nothing to rate), which is the
 * same on every device.
 */
export const STATS_HIDDEN_SECTIONS_PREFIX = "stats.hiddenSections.";
const KEY_PREFIX = STATS_HIDDEN_SECTIONS_PREFIX;

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
  // Bumps when the synced value from the server has been written to storage.
  const syncEpoch = useWebPrefsEpoch("statsHiddenSections");

  // Re-read when the tab changes: each tab keeps its own list, and a reader who
  // hid costs on flights has said nothing about cruises. And when the server's
  // copy arrived — otherwise the write below would put the old list back.
  useEffect(() => {
    setHidden(load(tab));
  }, [tab, syncEpoch]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${KEY_PREFIX}${tab}`, JSON.stringify(hidden));
    } catch {
      /* private mode or blocked site data — the choice does not survive a reload */
    }
    emitLocalPrefWrite(`${KEY_PREFIX}${tab}`);
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
