import type { FlightInput } from "../../types";
import { cruiseApi } from "../../lib/api/cruise";
import { tripsApi } from "../../lib/api/trips";
import { createImportBatch } from "../../lib/api/importBatches";
import { logger } from "../../lib/logger";
import { alreadyImportedId, deriveTripMeta, isAlreadyImported } from "./cruiseImportEntry";
import type { EntryData } from "./cruiseImportEntry";
import type { ReimportConflict } from "./CruiseReimportCompare";
import { missingFlights, storeFlights } from "./cruiseImportFlights";
import type { FlightGapItem } from "./cruiseImportFlights";

export interface CruiseImportOutcome {
  /** Cruises stored by this import. */
  created: number;
  /** Bookings the server already held (409). */
  alreadyThere: number;
  conflicts: ReimportConflict[];
  /** Flights stored by this import. */
  storedFlights: number;
  /** The trip the import filed under, if one was made and kept. */
  tripId?: string;
  /** Flights of the bookings that are not in the logbook, and why. */
  gap: FlightGapItem[];
}

/**
 * Stores a reviewed cruise import: the cruises, an optional trip, and the
 * fly & cruise flights (forgejo#225, review I4 and its residual).
 *
 * - The trip is made right before the first cruise is stored and taken back
 *   if every booking was already there — a re-read leaves no second trip.
 * - A NEW booking's flights are stored one by one; one that fails is
 *   reported, never lost behind the next read's 409.
 * - An ALREADY-imported booking's flights are looked up in the logbook; the
 *   missing ones are reported for the user to add, not created on their own
 *   (a flight deleted on purpose must not come back by itself).
 */
export async function storeCruiseImport(params: {
  entryData: readonly EntryData[];
  wantTrip: boolean;
  tripName: string;
  sourceFileName: string | null;
}): Promise<CruiseImportOutcome> {
  const { entryData, wantTrip } = params;
  let tripId: string | undefined;
  const ensureTrip = async (): Promise<string | undefined> => {
    if (wantTrip && !tripId) {
      const trip = await tripsApi.create({
        name: params.tripName,
        ...deriveTripMeta(entryData, new Date()),
      });
      tripId = trip.id;
    }
    return tripId;
  };

  // One import, one entry in the log. A batch that cannot be created must not
  // cost the user their import, so it falls back to unbatched.
  let batchId: string | null = null;
  try {
    batchId = await createImportBatch("cruise", "email", params.sourceFileName);
  } catch (err: unknown) {
    logger.error("storeCruiseImport: import batch create failed", err);
  }

  let alreadyThere = 0;
  const conflicts: ReimportConflict[] = [];
  const newFlights: FlightInput[] = [];
  const knownFlights: FlightInput[] = [];
  for (const e of entryData) {
    try {
      const trip = await ensureTrip();
      await cruiseApi.create({ ...e.input, tripId: trip, importBatchId: batchId });
      newFlights.push(...e.flightInputs);
    } catch (err: unknown) {
      // 409: "you already have this one" — the normal answer to re-reading a
      // forwarded confirmation. Its plan is compared afterwards; its flights
      // are checked against the logbook rather than created again.
      if (isAlreadyImported(err)) {
        alreadyThere += 1;
        knownFlights.push(...e.flightInputs);
        const existingId = alreadyImportedId(err);
        if (existingId) conflicts.push({ existingId, stops: e.stops });
        continue;
      }
      throw err;
    }
  }
  const created = entryData.length - alreadyThere;
  if (tripId && created === 0) {
    await tripsApi.delete(tripId).catch((err: unknown) => {
      logger.error("storeCruiseImport: removing the unused trip failed", err);
    });
    tripId = undefined;
  }

  const stored = await storeFlights(newFlights, { checkFirst: false, failedReason: "failed" });
  if (tripId && stored.ids.length > 0) {
    await tripsApi.assignFlights(tripId, { flightIds: stored.ids, action: "add" });
  }
  const missing = await missingFlights(knownFlights);

  return {
    created,
    alreadyThere,
    conflicts,
    storedFlights: stored.ids.length,
    tripId,
    gap: [...stored.gap, ...missing],
  };
}
