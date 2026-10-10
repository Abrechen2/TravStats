/**
 * WHICH WEB PREFERENCES FOLLOW THE USER, AND WHICH STAY ON THE DEVICE
 * (forgejo#200). This is the one place that decision is made and argued.
 *
 * A tester opened the web app on his phone and found the colours, the map
 * look and the dashboard filter all back at their defaults — they lived only
 * in the computer's localStorage. Everything below that describes WHAT the
 * user wants to see now follows the account, through
 * `/api/v1/settings/web-prefs` and `webPrefsSync.ts`.
 *
 * FOLLOW THE USER — they describe taste and the user's own data, which are
 * the same on every screen:
 *
 * | Section                  | Local storage                               | Why it follows |
 * |--------------------------|---------------------------------------------|----------------|
 * | `mapAppearance`          | `mapAppearance.v2` minus its chrome (below) | Colour modes and colours of all four map domains, basemap, line widths, marker sizes, labels, overlay (tour/roadtrip/rail/rental) appearance — the "colours and everything" of the report. |
 * | `globeChrome`            | `globeChrome.v1`                            | Auto-rotation and day/night shading are a look, not a layout. |
 * | `domainColors`           | `domainColors.v2`                           | The per-domain colour used across stats, timeline and sidebar. |
 * | `dashboardHiddenDomains` | `travstats.dashboard.hiddenDomains.v1`      | "I don't want cruises on my map" is about the user's travel, not the screen. |
 * | `theme`                  | `theme-storage`                             | The map theme. |
 * | `statsCompare`           | `stats-compare-storage`                     | The year-over-year comparison choice. |
 * | `statsHiddenSections`    | `stats.hiddenSections.<tab>`                | Hidden because the user records no prices or ratings — that is their data, the same everywhere. (It was per browser before, argued by screen size; the actual reason it was asked for is content.) |
 * | `tablePrefs`             | `travstats:table-hidden-columns:*`, `travstats:table-sort:*` | Which columns matter and how a list is ordered is a reading habit. |
 *
 * STAY ON THIS DEVICE — they describe the screen, the session or one-time
 * chrome, and syncing them would make one device's layout fight another's:
 *
 * - Table page size (`travstats:table-page-size:*`) — rows per page follows
 *   the screen's height; 100 rows on a desktop is a wall of scrolling on a phone.
 * - Map control-panel chrome inside `mapAppearance.v2` — `panelExpanded`,
 *   `panelSections`, `lodgingListOpen`. An open panel is fine on a desktop
 *   and covers the whole map on a phone. `MAP_DEVICE_ONLY_KEYS` below keeps
 *   them out of the section and keeps this device's value on apply.
 * - Dashboard legend open (`dashboard.legendOpen`) — the same layout argument.
 * - Last dashboard mode / projection (`travstats:dashboard:lastMode`,
 *   `…:lastProjection`) — navigation memory; the globe may be the desktop's
 *   habit and too heavy for a phone.
 * - Map camera (`mapCameraStore`) — where this screen was looking.
 * - One-time notices: `globeCoachmarkSeen`, `airport-seeding-modal-seen`,
 *   dismissed notices, the update badge's
 *   dismissed version. A hint shown once more on a new device costs a click;
 *   a hint suppressed because it was dismissed elsewhere may be the one this
 *   device's touch interaction needed.
 * - The trip gallery's group-by-day toggle (`travstats.gallery.groupByDay`)
 *   — not asked for in the report; a candidate if it is missed.
 * - Auth (`auth-storage`), caches (`timeEstimation` history) — not preferences.
 *
 * Language, units and the other settings on the settings page are already
 * server-side (`/settings`) and are not part of this.
 *
 * ADDING A SECTION: an entry here, the name in the server's
 * `backend/src/services/webPrefs/sections.ts`, and — if it lives in a raw
 * localStorage key — an `emitLocalPrefWrite(key)` beside its `setItem` and a
 * `useWebPrefsEpoch(section)` re-read wherever it was copied into state.
 */

import { useCruiseColorStore } from "../../store/cruiseColorStore";
import { useDashboardDomainFilterStore } from "../../store/dashboardDomainFilterStore";
import { DOMAIN_COLORS_KEY, useDomainColorStore } from "../../store/domainColorStore";
import { useFlightColorStore } from "../../store/flightColorStore";
import { useLodgingColorStore } from "../../store/lodgingColorStore";
import { useOverlayAppearanceStore } from "../../store/overlayAppearanceStore";
import { usePlaceColorStore } from "../../store/placeColorStore";
import { useStatsCompareStore } from "../../store/statsCompareStore";
import { useThemeStore } from "../../store/themeStore";
import {
  MAP_APPEARANCE_KEY,
  loadCruiseColorConfig,
  loadFlightColorConfig,
  loadLodgingColorConfig,
  loadMapAppearance,
  loadOverlayAppearance,
  loadPlaceColorConfig,
} from "../../components/map/mapAppearance";
import { GLOBE_CHROME_KEY } from "../../components/map/globeChrome";
import { TABLE_HIDDEN_COLUMNS_PREFIX } from "../../components/table/useColumnPrefs";
import { TABLE_SORT_PREFIX } from "../../components/table/useSortPrefs";
import { STATS_HIDDEN_SECTIONS_PREFIX } from "../../hooks/useSectionVisibility";
import { domainColorOverrides, normalizeDomainColors } from "../domainColor";
import {
  HIDDEN_DOMAINS_STORAGE_KEY,
  parseHiddenDomains,
  serializeHiddenDomains,
} from "../../shared/dashboardDomainFilter";
import type { MapTheme } from "../../types/mapTheme";
import { useWebPrefsEpochStore } from "./prefEvents";
import {
  isNonEmptyStringList,
  isPlainObject,
  isStringList,
  onKey,
  onPrefixes,
  readJson,
  readPrefixed,
  replacePrefixed,
  writeJson,
} from "./storageSections";
import { stableStringify, type WebPrefSectionDef } from "./webPrefsSync";

/** Control-panel chrome inside `mapAppearance.v2` that stays per device (see above). */
export const MAP_DEVICE_ONLY_KEYS = ["panelExpanded", "panelSections", "lodgingListOpen"];

/**
 * What the maps write into `mapAppearance.v2` on MOUNT, with the value they
 * write when nothing was chosen. A blob made only of these is not a choice —
 * every browser that ever showed a map has one — so it must not seed the
 * server and overwrite a customised device (`isDefault`). The legacy
 * single-colour fields count as unchosen when null: null was written on
 * every mount (see `lib/flightColor.ts`).
 */
const MAP_MOUNT_DEFAULTS: Record<string, unknown> = {
  styleId: "dark",
  flightRouteShape: "arc",
  flightRouteWidth: 1,
  airportColor: null,
  flightMarkerSize: 1,
  cruiseRouteWidth: 1,
  portColor: null,
  cruiseMarkerSize: 1,
  cruiseArrowScale: 1,
  showTerrain: false,
  showPlaceLabels: true,
  labelsMode: "important",
  placeLabelSource: "list",
  lodgingMarkerSize: 1,
  placeMarkerSize: 1,
  routeColor: null,
  cruiseRouteColor: null,
};

const MAP_THEMES: readonly MapTheme[] = ["glassmorphism", "classic"];

const bump = (section: string) => useWebPrefsEpochStore.getState().bump(section);

function omit(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
}

const isSort = (value: unknown): boolean =>
  isPlainObject(value) &&
  typeof value.by === "string" &&
  (value.order === "asc" || value.order === "desc");

/** Selector-change subscription for a Zustand store. */
function onStoreChange<S>(
  store: { subscribe: (listener: (state: S, prev: S) => void) => () => void },
  changed: (state: S, prev: S) => boolean
) {
  return (onChange: () => void) =>
    store.subscribe((state, prev) => {
      if (changed(state, prev)) onChange();
    });
}

const mapAppearance: WebPrefSectionDef = {
  name: "mapAppearance",
  read: () => omit(loadMapAppearance() as Record<string, unknown>, MAP_DEVICE_ONLY_KEYS),
  isDefault: (value) =>
    isPlainObject(value) &&
    Object.entries(value).every(
      ([k, v]) =>
        k in MAP_MOUNT_DEFAULTS && stableStringify(v) === stableStringify(MAP_MOUNT_DEFAULTS[k])
    ),
  apply: (value) => {
    if (!isPlainObject(value)) return;
    const local = readJson(MAP_APPEARANCE_KEY);
    const deviceOnly = isPlainObject(local) ? pick(local, MAP_DEVICE_ONLY_KEYS) : {};
    writeJson(MAP_APPEARANCE_KEY, { ...omit(value, MAP_DEVICE_ONLY_KEYS), ...deviceOnly });
    // The stores copied the blob at module load; hand them the new one.
    useFlightColorStore.setState({ config: loadFlightColorConfig() });
    useCruiseColorStore.setState({ config: loadCruiseColorConfig() });
    useLodgingColorStore.setState({ config: loadLodgingColorConfig() });
    usePlaceColorStore.setState({ config: loadPlaceColorConfig() });
    useOverlayAppearanceStore.setState({ appearance: loadOverlayAppearance() });
    // The maps copied it into component state at mount — they remount on this.
    bump("mapAppearance");
  },
  subscribe: onKey(MAP_APPEARANCE_KEY),
};

const globeChrome: WebPrefSectionDef = {
  name: "globeChrome",
  read: () => {
    const stored = readJson(GLOBE_CHROME_KEY);
    return isPlainObject(stored) ? stored : {};
  },
  isDefault: (value) =>
    isPlainObject(value) && value.autoRotate !== true && value.showNight !== false,
  apply: (value) => {
    if (!isPlainObject(value)) return;
    writeJson(GLOBE_CHROME_KEY, value);
    bump("globeChrome");
  },
  subscribe: onKey(GLOBE_CHROME_KEY),
};

const domainColors: WebPrefSectionDef = {
  name: "domainColors",
  read: () => domainColorOverrides(useDomainColorStore.getState().colors),
  isDefault: (value) => isPlainObject(value) && Object.keys(value).length === 0,
  apply: (value) => {
    if (!isPlainObject(value)) return;
    const colors = normalizeDomainColors(value);
    writeJson(DOMAIN_COLORS_KEY, domainColorOverrides(colors));
    useDomainColorStore.setState({ colors });
  },
  subscribe: onStoreChange(useDomainColorStore, (s, p) => s.colors !== p.colors),
};

const dashboardHiddenDomains: WebPrefSectionDef = {
  name: "dashboardHiddenDomains",
  read: () =>
    JSON.parse(serializeHiddenDomains(useDashboardDomainFilterStore.getState().hidden)) as unknown,
  isDefault: (value) => Array.isArray(value) && value.length === 0,
  apply: (value) => {
    if (!isStringList(value)) return;
    const hidden = parseHiddenDomains(JSON.stringify(value));
    try {
      window.localStorage.setItem(HIDDEN_DOMAINS_STORAGE_KEY, serializeHiddenDomains(hidden));
    } catch {
      // see storageSections.writeJson
    }
    // A shared link in view keeps showing the link's set (`linkHidden`); this
    // replaces the reader's own selection underneath it.
    useDashboardDomainFilterStore.setState({ hidden });
  },
  subscribe: onStoreChange(useDashboardDomainFilterStore, (s, p) => s.hidden !== p.hidden),
};

const theme: WebPrefSectionDef = {
  name: "theme",
  read: () => ({ mapTheme: useThemeStore.getState().mapTheme }),
  isDefault: (value) => isPlainObject(value) && value.mapTheme === "glassmorphism",
  apply: (value) => {
    if (!isPlainObject(value)) return;
    const mapTheme = value.mapTheme;
    if (MAP_THEMES.includes(mapTheme as MapTheme)) {
      useThemeStore.setState({ mapTheme: mapTheme as MapTheme });
    }
  },
  subscribe: onStoreChange(useThemeStore, (s, p) => s.mapTheme !== p.mapTheme),
};

const statsCompare: WebPrefSectionDef = {
  name: "statsCompare",
  read: () => {
    const { compareEnabled, compareYear, hasSetPreference } = useStatsCompareStore.getState();
    return { compareEnabled, compareYear, hasSetPreference };
  },
  isDefault: (value) => isPlainObject(value) && value.hasSetPreference !== true,
  apply: (value) => {
    if (!isPlainObject(value)) return;
    const { compareEnabled, compareYear, hasSetPreference } = value;
    if (typeof compareEnabled !== "boolean" || typeof hasSetPreference !== "boolean") return;
    if (compareYear !== null && typeof compareYear !== "number") return;
    useStatsCompareStore.setState({ compareEnabled, compareYear, hasSetPreference });
  },
  subscribe: onStoreChange(
    useStatsCompareStore,
    (s, p) =>
      s.compareEnabled !== p.compareEnabled ||
      s.compareYear !== p.compareYear ||
      s.hasSetPreference !== p.hasSetPreference
  ),
};

const statsHiddenSections: WebPrefSectionDef = {
  name: "statsHiddenSections",
  // Empty lists are dropped: the hook writes `[]` for every tab it opens, and
  // that is not a choice.
  read: () => readPrefixed(STATS_HIDDEN_SECTIONS_PREFIX, isNonEmptyStringList),
  isDefault: (value) => isPlainObject(value) && Object.keys(value).length === 0,
  apply: (value) => {
    if (!isPlainObject(value)) return;
    replacePrefixed(STATS_HIDDEN_SECTIONS_PREFIX, value, isStringList);
    bump("statsHiddenSections");
  },
  subscribe: onPrefixes(STATS_HIDDEN_SECTIONS_PREFIX),
};

const tablePrefs: WebPrefSectionDef = {
  name: "tablePrefs",
  read: () => ({
    hiddenColumns: readPrefixed(TABLE_HIDDEN_COLUMNS_PREFIX, isNonEmptyStringList),
    sort: readPrefixed(TABLE_SORT_PREFIX, isSort),
  }),
  isDefault: (value) =>
    isPlainObject(value) &&
    (!isPlainObject(value.hiddenColumns) || Object.keys(value.hiddenColumns).length === 0) &&
    (!isPlainObject(value.sort) || Object.keys(value.sort).length === 0),
  apply: (value) => {
    if (!isPlainObject(value)) return;
    const hiddenColumns = isPlainObject(value.hiddenColumns) ? value.hiddenColumns : {};
    const sort = isPlainObject(value.sort) ? value.sort : {};
    replacePrefixed(TABLE_HIDDEN_COLUMNS_PREFIX, hiddenColumns, isStringList);
    replacePrefixed(TABLE_SORT_PREFIX, sort, isSort);
    bump("tablePrefs");
  },
  subscribe: onPrefixes(TABLE_HIDDEN_COLUMNS_PREFIX, TABLE_SORT_PREFIX),
};

/** Every synced section. The server knows the same names. */
export const WEB_PREF_SECTIONS: readonly WebPrefSectionDef[] = [
  mapAppearance,
  globeChrome,
  domainColors,
  dashboardHiddenDomains,
  theme,
  statsCompare,
  statsHiddenSections,
  tablePrefs,
];
