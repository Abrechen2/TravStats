import { useEffect, useState } from "react";
import { getPlaceRelations, type PlaceRelations } from "../lib/api/places";
import { logger } from "../lib/logger";

/**
 * What hangs off a place, asked only while a question about it is open (the
 * delete confirmation, the merge preview). `null` while it loads and when it
 * fails: an unknown count is said as unknown, never as "none" — the dialog
 * keeps its base sentence and names what stays in general terms.
 */
export function usePlaceRelations(placeId: string | null): PlaceRelations | null {
  const [relations, setRelations] = useState<PlaceRelations | null>(null);

  useEffect(() => {
    setRelations(null);
    if (placeId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await getPlaceRelations(placeId);
        if (!cancelled) setRelations(found);
      } catch (err: unknown) {
        logger.error({ err, placeId }, "usePlaceRelations: could not count what hangs off a place");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  return relations;
}
