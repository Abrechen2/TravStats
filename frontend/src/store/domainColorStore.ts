import { create } from "zustand";

import {
  BRAND_DOMAIN_COLORS,
  normalizeDomainColors,
  type DomainColorMap,
} from "../lib/domainColor";
import type { DomainKey } from "../shared/domains";

/**
 * The one per-domain colour, for every surface outside the map.
 *
 * Deliberately NOT stored in the `mapAppearance` blob next to the four map
 * colour stores. These colours are not a map setting — that is the whole point
 * of #270: the statistics, the trip timeline and the activity sidebar read
 * them too, and filing them under "map appearance" is how they ended up
 * unreachable from everywhere else in the first place.
 *
 * Local storage rather than the server, matching the map colour stores. That
 * means the choice does not follow the user to another device; a server-side
 * setting would, and is the obvious later step. It is called out here rather
 * than left to be discovered.
 */
const KEY = "domainColors.v1";

interface DomainColorState {
  colors: DomainColorMap;
  setColor: (domain: DomainKey, hex: string) => void;
  /** Back to BRAND.md §3 — without it there is no way home from an experiment. */
  resetToBrand: () => void;
}

function load(): DomainColorMap {
  if (typeof window === "undefined") return BRAND_DOMAIN_COLORS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return BRAND_DOMAIN_COLORS;
    return normalizeDomainColors(JSON.parse(raw) as unknown);
  } catch {
    // Unreadable storage is not a reason to show a colourless app.
    return BRAND_DOMAIN_COLORS;
  }
}

function persist(colors: DomainColorMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(colors));
  } catch {
    /* private mode, quota, blocked site data — the choice simply does not survive a reload */
  }
}

export const useDomainColorStore = create<DomainColorState>((set) => ({
  colors: load(),
  setColor: (domain, hex) =>
    set((state) => {
      const colors = normalizeDomainColors({ ...state.colors, [domain]: hex });
      persist(colors);
      return { colors };
    }),
  resetToBrand: () =>
    set(() => {
      persist(BRAND_DOMAIN_COLORS);
      return { colors: BRAND_DOMAIN_COLORS };
    }),
}));
