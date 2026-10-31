/**
 * The Track map's appearance (TravTrack plan T5.2) as a web-prefs section:
 * which layers are on, the route's colour and opacity, and the client-side
 * pause split. It follows the account (`registry.ts`, section `trackMap`),
 * with a local cache under `PREFS_KEY` like every raw-localStorage section.
 * Panel expansion and the viewport are not in here: they stay per device.
 *
 * Until 2.8.0-rc.5 this was its own per-browser document (`LEGACY_PREFS_KEY`).
 * `migrateLegacyTrackPrefs` carries it over once.
 */

import { emitLocalPrefWrite } from "./prefEvents";

export const TRACK_LAYERS = [
  "routes",
  "points",
  "heat",
  "fog",
  "visits",
  "entries",
  "photos",
  "countries",
] as const;
export type TrackLayer = (typeof TRACK_LAYERS)[number];

export type RouteColorMode = "speed" | "plain";

/** Minutes after which a pause splits a stretch; null keeps the server's cuts only. */
export const SPLIT_OPTIONS = [null, 5, 15, 30, 120, 360] as const;
export type SplitMinutes = (typeof SPLIT_OPTIONS)[number];

export interface TrackMapPrefs {
  layers: Record<TrackLayer, boolean>;
  color: RouteColorMode;
  /** 0.2 … 1 */
  opacity: number;
  splitMinutes: SplitMinutes;
}

export const DEFAULT_PREFS: TrackMapPrefs = {
  layers: {
    routes: true,
    points: false,
    heat: false,
    fog: false,
    visits: true,
    entries: true,
    photos: false,
    countries: false,
  },
  color: "speed",
  opacity: 0.85,
  splitMinutes: null,
};

/** The local cache of the account's `trackMap` section. */
export const PREFS_KEY = "travstats.track.mapPrefs.v2";
/** The per-browser document of 2.8.0-rc.5 and before. */
export const LEGACY_PREFS_KEY = "travstats.track.mapPrefs.v1";

/** What storage held, read field by field; anything unknown takes its default. */
export function parsePrefs(raw: string | null): TrackMapPrefs {
  if (!raw) return DEFAULT_PREFS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_PREFS;
  const v = value as Partial<Record<keyof TrackMapPrefs, unknown>>;
  const storedLayers = (
    typeof v.layers === "object" && v.layers !== null ? v.layers : {}
  ) as Record<string, unknown>;
  const layers = Object.fromEntries(
    TRACK_LAYERS.map((id) => [
      id,
      typeof storedLayers[id] === "boolean" ? storedLayers[id] : DEFAULT_PREFS.layers[id],
    ])
  ) as Record<TrackLayer, boolean>;
  const opacity =
    typeof v.opacity === "number" && v.opacity >= 0.2 && v.opacity <= 1
      ? v.opacity
      : DEFAULT_PREFS.opacity;
  const split = (SPLIT_OPTIONS as readonly unknown[]).includes(v.splitMinutes)
    ? (v.splitMinutes as SplitMinutes)
    : DEFAULT_PREFS.splitMinutes;
  return {
    layers,
    color: v.color === "plain" || v.color === "speed" ? v.color : DEFAULT_PREFS.color,
    opacity,
    splitMinutes: split,
  };
}

/**
 * Carries the rc.5 document into the account-synced cache, once. The new key
 * wins when both exist (a second run, or a second tab, never overwrites a
 * choice made since); the old key is removed only after the new one is
 * written, so a blocked storage loses nothing and the next run tries again.
 * The write is announced, so the sync uploads it as this device's seed.
 */
export function migrateLegacyTrackPrefs(): void {
  try {
    const legacy = window.localStorage.getItem(LEGACY_PREFS_KEY);
    if (legacy === null) return;
    if (window.localStorage.getItem(PREFS_KEY) === null) {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(parsePrefs(legacy)));
      emitLocalPrefWrite(PREFS_KEY);
    }
    window.localStorage.removeItem(LEGACY_PREFS_KEY);
  } catch {
    // Storage blocked: nothing was moved, nothing was removed.
  }
}

export function loadTrackPrefs(): TrackMapPrefs {
  migrateLegacyTrackPrefs();
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Whether the choice reached storage. A `false` is the panel's "not remembered" note. */
export function saveTrackPrefs(prefs: TrackMapPrefs): boolean {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    return false;
  }
  emitLocalPrefWrite(PREFS_KEY);
  return true;
}
