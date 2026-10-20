import { useCallback, useEffect, useState } from "react";
import { tripRecordingApi, type TripRecordingView } from "../lib/api/tripRecording";
import { logger } from "../lib/logger";

export interface TripRecordingState {
  /** Null until the first answer — and after a failure. */
  view: TripRecordingView | null;
  /** The recording could not be loaded: the map must say so, not look unrecorded. */
  failed: boolean;
  reload: () => void;
}

/**
 * The trip's recording for the map (forgejo#316), re-read when the day filter
 * changes or after a delete. A failed read is its own state — "nothing was
 * recorded" and "I could not ask" must not look alike.
 */
export function useTripRecording(tripId: string, day: string | null): TripRecordingState {
  const [view, setView] = useState<TripRecordingView | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void (async (): Promise<void> => {
      try {
        const next = await tripRecordingApi.get(tripId, day);
        if (!cancelled) setView(next);
      } catch (err: unknown) {
        if (cancelled) return;
        logger.warn("useTripRecording: failed to load the trip's recording", err);
        setView(null);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, day, generation]);

  return { view, failed, reload };
}
