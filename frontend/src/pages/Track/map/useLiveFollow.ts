import { useEffect, useRef, useState } from "react";
import { logger } from "../../../lib/logger";
import { trackErrorKey, travTrackApi } from "../../../lib/api/travtrack";
import type { LonLat } from "./trackGeometry";

/** How often live follow asks for the newest fix. */
export const LIVE_POLL_MS = 30_000;

export type LiveState =
  { kind: "off" } | { kind: "following"; at: LonLat | null } | { kind: "failed"; key: string };

/**
 * „Live folgen" (TravTrack plan T5.2): while on, reads the existing
 * last-seen answer every half minute; when a newer fix arrived, today is read
 * again (`onNewer`, also on the first answer) and the camera goes to that fix — already the last
 * privacy-safe one, the server's own choice. A failed poll says so and keeps
 * polling.
 */
export function useLiveFollow(enabled: boolean, onNewer: () => Promise<void>): LiveState {
  const [state, setState] = useState<LiveState>({ kind: "off" });
  const seen = useRef<string | null>(null);
  const callback = useRef(onNewer);
  useEffect(() => {
    callback.current = onNewer;
  }, [onNewer]);

  useEffect(() => {
    if (!enabled) {
      setState({ kind: "off" });
      seen.current = null;
      return;
    }
    let live = true;
    setState({ kind: "following", at: null });
    const poll = () => {
      travTrackApi
        .lastSeen()
        .then(async (last) => {
          if (!live) return;
          // Every newer fix — the first one too, since today may have been read before it.
          if (last && last.at !== seen.current) {
            await callback.current();
            // Only once today is read again: a failed read is tried at the next poll.
            seen.current = last.at;
          }
          if (live) {
            setState({ kind: "following", at: last ? [last.lon, last.lat] : null });
          }
        })
        .catch((err: unknown) => {
          logger.warn("TravTrack live follow failed", err);
          if (live) setState({ kind: "failed", key: trackErrorKey(err) });
        });
    };
    poll();
    const id = setInterval(poll, LIVE_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [enabled]);

  return state;
}
