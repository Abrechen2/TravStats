import { useEffect, useState } from "react";
import { getPlaceRelations, type PlaceRelations } from "../lib/api/places";
import { logger } from "../lib/logger";

export interface PlaceRelationsResult {
  /** The counts, or null while they load and when they could not be had. */
  relations: PlaceRelations | null;
  /** The request failed — "unknown", which a caller says as such. */
  failed: boolean;
}

/**
 * What hangs off a place, asked only while a question about it is open (the
 * delete confirmation, the merge preview). An unknown count is said as
 * unknown, never as "none".
 */
export function usePlaceRelationsResult(placeId: string | null): PlaceRelationsResult {
  const [result, setResult] = useState<PlaceRelationsResult>({ relations: null, failed: false });

  useEffect(() => {
    setResult({ relations: null, failed: false });
    if (placeId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await getPlaceRelations(placeId);
        if (!cancelled) setResult({ relations: found, failed: false });
      } catch (err: unknown) {
        logger.error({ err, placeId }, "usePlaceRelations: could not count what hangs off a place");
        if (!cancelled) setResult({ relations: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  return result;
}

/**
 * The counts alone, null while they load and when they fail — for the delete
 * question, which keeps its base sentence either way.
 */
export function usePlaceRelations(placeId: string | null): PlaceRelations | null {
  return usePlaceRelationsResult(placeId).relations;
}
