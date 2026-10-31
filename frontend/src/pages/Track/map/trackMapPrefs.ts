import { useCallback, useEffect, useRef, useState } from "react";
import { useWebPrefsEpoch } from "../../../lib/webPrefs/prefEvents";
import { loadTrackPrefs, saveTrackPrefs, type TrackMapPrefs } from "../../../lib/webPrefs/trackMap";

/**
 * How the reader likes the Track map drawn (TravTrack plan T5.2). The model,
 * the defaults and the storage live in `lib/webPrefs/trackMap.ts`: the
 * appearance follows the account (web-prefs section `trackMap`).
 */
export {
  DEFAULT_PREFS,
  PREFS_KEY,
  SPLIT_OPTIONS,
  TRACK_LAYERS,
  parsePrefs,
  type RouteColorMode,
  type SplitMinutes,
  type TrackLayer,
  type TrackMapPrefs,
} from "../../../lib/webPrefs/trackMap";

export function useTrackMapPrefs(): [
  TrackMapPrefs,
  (patch: Partial<TrackMapPrefs>) => void,
  boolean,
] {
  const [prefs, setPrefs] = useState<TrackMapPrefs>(loadTrackPrefs);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(prefs);
  latest.current = prefs;

  // The account's value arrived after this panel mounted: show it, and let the
  // next edit build on it rather than on what this browser had.
  const epoch = useWebPrefsEpoch("trackMap");
  const firstEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch === firstEpoch.current) return;
    const next = loadTrackPrefs();
    latest.current = next;
    setPrefs(next);
  }, [epoch]);

  const update = useCallback((patch: Partial<TrackMapPrefs>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setPrefs(next);
    setSaveFailed(!saveTrackPrefs(next));
  }, []);
  return [prefs, update, saveFailed];
}
