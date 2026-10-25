import { useEffect, useState } from "react";
import { trackErrorKey, travTrackApi, type TravTrackLastSeen } from "../lib/api/travtrack";
import { logger } from "../lib/logger";
import { now } from "../shared/time/clock";

/**
 * „Zuletzt gesehen" (TravTrack plan L2), read for the dashboard card and the
 * `/track` header. Asks nothing while `enabled` is false — TravTrack not
 * visible for this account. Read again every five minutes; `nowMs` ticks every
 * minute so the age stays true between reads. A failed read is a state of its
 * own with the i18n key of its reason, never an empty answer.
 */

export type LastSeenState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; key: string }
  | { kind: "loaded"; lastSeen: TravTrackLastSeen | null };

const REFRESH_MS = 5 * 60_000;
const TICK_MS = 60_000;

export function useLastSeen(enabled: boolean): { state: LastSeenState; nowMs: number } {
  const [state, setState] = useState<LastSeenState>({ kind: "idle" });
  const [nowMs, setNowMs] = useState(() => now().getTime());

  useEffect(() => {
    if (!enabled) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    const read = () => {
      travTrackApi
        .lastSeen()
        .then((lastSeen) => {
          if (live) setState({ kind: "loaded", lastSeen });
        })
        .catch((err: unknown) => {
          logger.warn("TravTrack last seen could not be loaded", err);
          if (live) setState({ kind: "failed", key: trackErrorKey(err) });
        });
    };
    setState({ kind: "loading" });
    read();
    const refresh = setInterval(read, REFRESH_MS);
    const tick = setInterval(() => setNowMs(now().getTime()), TICK_MS);
    return () => {
      live = false;
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [enabled]);

  return { state, nowMs };
}
