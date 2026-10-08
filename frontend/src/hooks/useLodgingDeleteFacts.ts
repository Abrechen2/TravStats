import { useEffect, useState } from "react";

import { getLodgingDeleteFacts } from "../lib/api/lodging";
import { tripsApi } from "../lib/api";
import { logger } from "../lib/logger";
import type { LodgingDeleteFacts } from "../lib/lodgingDeleteMessage";
import type { Lodging } from "../types/lodging";

const UNKNOWN: LodgingDeleteFacts = { documentCount: null, photoCount: null, tripNames: [] };

/**
 * What deleting a house takes with it besides its stays, asked only while the
 * confirmation is open (forgejo#250).
 *
 * The delete cascades through two things the dialog's one sentence did not
 * name: the house's photographs and every stay's kept originals - counted by
 * ONE request (`GET /lodging/:id/delete-facts`; it used to be one per stay) -
 * and, by omission, what stays: the trips the stays were linked to.
 *
 * Each answer is independent and `null` / empty means "not known", never
 * "none": a count that could not be read must not read as "no documents".
 * The dialog opens at once with its base sentence and grows lines as the
 * answers arrive; a warning is worth adding to a question, never worth
 * delaying it. Pass `null` while no confirmation is open.
 */
export function useLodgingDeleteFacts(
  lodging: Pick<Lodging, "id" | "stays"> | null
): LodgingDeleteFacts {
  const [facts, setFacts] = useState<LodgingDeleteFacts>(UNKNOWN);
  const id = lodging?.id ?? null;
  // The trips by value, so a parent re-rendering with a fresh array does not refetch.
  const tripKey =
    lodging === null
      ? ""
      : [...new Set(lodging.stays.flatMap((s) => (s.tripId ? [s.tripId] : [])))].sort().join(",");

  useEffect(() => {
    if (id === null) {
      setFacts(UNKNOWN);
      return;
    }
    let cancelled = false;
    // One house's answer must not leak into the next one's dialog.
    setFacts(UNKNOWN);
    const tripIds = new Set(tripKey === "" ? [] : tripKey.split(","));
    const patch = (part: Partial<LodgingDeleteFacts>): void => {
      if (!cancelled) setFacts((prev) => ({ ...prev, ...part }));
    };

    void (async () => {
      try {
        const counts = await getLodgingDeleteFacts(id);
        patch({ documentCount: counts.documentCount, photoCount: counts.photoCount });
      } catch (err: unknown) {
        logger.error("useLodgingDeleteFacts: could not count what goes with the house", err);
      }
    })();
    if (tripIds.size > 0) {
      void (async () => {
        try {
          const trips = await tripsApi.getAll();
          patch({
            tripNames: trips.filter((trip) => tripIds.has(trip.id)).map((trip) => trip.name),
          });
        } catch (err: unknown) {
          logger.error("useLodgingDeleteFacts: could not name the linked trips", err);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [id, tripKey]);

  return facts;
}
