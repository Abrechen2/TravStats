import { useCallback, useState } from "react";

/**
 * How the reader likes the Track map drawn (TravTrack plan T5.2): which layers
 * are on, the route's colour and opacity, and the client-side pause split.
 * Remembered per browser — a convenience, so a storage that throws or holds
 * something unreadable falls back to the defaults, and the map works without.
 */

export const TRACK_LAYERS = ["routes", "points", "heat", "fog", "visits", "entries"] as const;
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
  layers: { routes: true, points: false, heat: false, fog: false, visits: true, entries: true },
  color: "speed",
  opacity: 0.85,
  splitMinutes: null,
};

export const PREFS_KEY = "travstats.track.mapPrefs.v1";

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

function load(): TrackMapPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

function save(prefs: TrackMapPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private window or blocked storage: the map keeps working, it just forgets.
  }
}

export function useTrackMapPrefs(): [TrackMapPrefs, (patch: Partial<TrackMapPrefs>) => void] {
  const [prefs, setPrefs] = useState<TrackMapPrefs>(load);
  const update = useCallback((patch: Partial<TrackMapPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);
  return [prefs, update];
}
