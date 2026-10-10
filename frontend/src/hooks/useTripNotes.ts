import { useCallback, useEffect, useState } from "react";

import { notesApi, type TripNotes } from "../lib/api/notes";
import { logger } from "../lib/logger";

export interface TripNotesState {
  /** The notes on the trip's days; null until loaded or after a failure. */
  notes: TripNotes | null;
  /** True when the last load failed — the timeline says so instead of showing none. */
  failed: boolean;
  reload: () => void;
}

/**
 * The standalone notes on a trip's days (forgejo#146): the reader's own and,
 * on a shared trip, the other members' shareable ones. A failure does not
 * blank the trip — the rest of the timeline stands — but it is reported, so
 * "no notes" and "notes could not be loaded" never look the same.
 */
export function useTripNotes(tripId: string): TripNotesState {
  const [notes, setNotes] = useState<TripNotes | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await notesApi.forTrip(tripId);
        if (cancelled) return;
        setNotes(loaded);
        setFailed(false);
      } catch (err: unknown) {
        logger.error({ err }, "TripDetailPage: failed to load the trip's notes");
        if (cancelled) return;
        setNotes(null);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { notes, failed, reload };
}
