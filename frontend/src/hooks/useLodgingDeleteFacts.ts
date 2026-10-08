import { useEffect, useState } from "react";

import { documentsApi } from "../lib/api/documents";
import { listLodgingPhotos } from "../lib/api/lodging";
import { tripsApi } from "../lib/api";
import { logger } from "../lib/logger";
import type { LodgingDeleteFacts } from "../lib/lodgingDeleteMessage";
import type { Lodging } from "../types/lodging";

const UNKNOWN: LodgingDeleteFacts = { documentCount: null, photoCount: null, tripNames: [] };

/**
 * What deleting a house takes with it besides its stays, asked only while the
 * confirmation is open (forgejo#250).
 *
 * The delete cascades through three things the dialog's one sentence did not
 * name: every stay's kept originals (`Document` cascades from `lodgingStay`,
 * `integrity/cascades.integrity.test.ts`), the house's own photographs
 * (`LodgingPhoto` cascades from `lodging`, and the files are removed from
 * disk), and - by omission - what stays: the trips the stays were linked to.
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
  // The stays by value, so a parent re-rendering with a fresh array does not
  // refetch; what matters is WHICH stays and trips there are.
  const stayKey =
    lodging === null ? "" : lodging.stays.map((s) => `${s.id}:${s.tripId ?? ""}`).join(",");

  useEffect(() => {
    if (id === null || lodging === null) {
      setFacts(UNKNOWN);
      return;
    }
    let cancelled = false;
    // One house's answer must not leak into the next one's dialog.
    setFacts(UNKNOWN);
    const stayIds = lodging.stays.map((s) => s.id);
    const tripIds = new Set(lodging.stays.flatMap((s) => (s.tripId ? [s.tripId] : [])));
    const patch = (part: Partial<LodgingDeleteFacts>): void => {
      if (!cancelled) setFacts((prev) => ({ ...prev, ...part }));
    };

    void (async () => {
      try {
        const perStay = await Promise.all(
          stayIds.map((stayId) => documentsApi.listForEntry({ type: "lodgingStay", id: stayId }))
        );
        patch({ documentCount: perStay.reduce((sum, docs) => sum + docs.length, 0) });
      } catch (err: unknown) {
        logger.error("useLodgingDeleteFacts: could not count documents", err);
      }
    })();
    void (async () => {
      try {
        const photos = await listLodgingPhotos(id);
        patch({ photoCount: photos.length });
      } catch (err: unknown) {
        logger.error("useLodgingDeleteFacts: could not count photos", err);
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
    // `stayKey` stands for the stays and trips; the lodging object itself is
    // rebuilt by its parent on every render.
  }, [id, stayKey]);

  return facts;
}
