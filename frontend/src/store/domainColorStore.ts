import { create } from "zustand";

import {
  BRAND_DOMAIN_COLORS,
  domainColorOverrides,
  migrateLegacyDomainColors,
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
 * Persisted in local storage, like the map colour stores, and since
 * forgejo#200 carried to the user's other devices by the web-prefs sync
 * (`lib/webPrefs/registry.ts`), which subscribes to this store.
 *
 * v2 stores only the overrides. v1 stored the whole map, which froze every
 * untouched domain at the default of the day it was saved — so the round-29
 * rail and roadtrip hues (forgejo#131) would never have reached anyone who had
 * ever moved a picker. v1 is still read once, through the retired-defaults
 * table, and the next save writes v2.
 */
/** Exported for the web-prefs sync (`lib/webPrefs/registry.ts`), which follows it. */
export const DOMAIN_COLORS_KEY = "domainColors.v2";
const KEY = DOMAIN_COLORS_KEY;
const LEGACY_KEY = "domainColors.v1";

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
    if (raw) return normalizeDomainColors(JSON.parse(raw) as unknown);
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrateLegacyDomainColors(JSON.parse(legacy) as unknown);
    return BRAND_DOMAIN_COLORS;
  } catch {
    // Unreadable storage is not a reason to show a colourless app.
    return BRAND_DOMAIN_COLORS;
  }
}

function persist(colors: DomainColorMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(domainColorOverrides(colors)));
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
