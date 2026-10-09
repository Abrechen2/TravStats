import { useCallback, useEffect, useState } from "react";
import { documentsApi, type TravelDocument } from "../../lib/api/documents";
import { logger } from "../../lib/logger";

/** One leg's originals: still asking, the list (possibly empty), or a failed ask. */
export type LegDocuments =
  { state: "loading" } | { state: "loaded"; documents: TravelDocument[] } | { state: "failed" };

/**
 * The kept originals of every leg of a connection (forgejo#235), so a ticket
 * opens from the connection view without opening each train's own page.
 *
 * One request per leg, through the existing documents router — a connection
 * is two to four trains, and a bundled endpoint would be a second way to list
 * the same thing. Each leg settles on its own: one failed ask is that leg's
 * "konnte nicht geladen werden" with a retry, never "no documents" and never
 * the whole view's failure.
 */
export function useRailLegDocuments(legIds: readonly string[]): {
  byLeg: ReadonlyMap<string, LegDocuments>;
  retry: (legId: string) => void;
} {
  const [byLeg, setByLeg] = useState<ReadonlyMap<string, LegDocuments>>(new Map());
  const key = legIds.join(",");

  const load = useCallback(async (legId: string, isLive: () => boolean): Promise<void> => {
    setByLeg((prev) => new Map(prev).set(legId, { state: "loading" }));
    try {
      const documents = await documentsApi.listForEntry({ type: "railJourney", id: legId });
      if (isLive()) setByLeg((prev) => new Map(prev).set(legId, { state: "loaded", documents }));
    } catch (err: unknown) {
      logger.warn("useRailLegDocuments: documents of a leg not loaded", err);
      if (isLive()) setByLeg((prev) => new Map(prev).set(legId, { state: "failed" }));
    }
  }, []);

  useEffect(() => {
    let live = true;
    const ids = key === "" ? [] : key.split(",");
    setByLeg(new Map(ids.map((id) => [id, { state: "loading" } as const])));
    for (const id of ids) void load(id, () => live);
    return () => {
      live = false;
    };
  }, [key, load]);

  const retry = useCallback((legId: string): void => void load(legId, () => true), [load]);

  return { byLeg, retry };
}
