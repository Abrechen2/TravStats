import { useEffect, useState } from "react";
import { listMemberships } from "../../lib/api/lodging";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import type { LodgingMembership } from "../../types/lodging";
import type { Trip } from "../../types";

/** The loyalty cards and trips the editor offers — each failure is logged and leaves its list empty. */
export function useStayEditorLookups(): { memberships: LodgingMembership[]; trips: Trip[] } {
  const [memberships, setMemberships] = useState<LodgingMembership[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listMemberships();
        if (!cancelled) setMemberships(rows);
      } catch (err: unknown) {
        logger.error("StayEditor: failed to load memberships", err);
      }
    })();
    void (async () => {
      try {
        const rows = await tripsApi.getAll();
        if (!cancelled) setTrips(rows);
      } catch (err: unknown) {
        logger.error("StayEditor: failed to load trips", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { memberships, trips };
}
