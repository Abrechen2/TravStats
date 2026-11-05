import type { DbTransaction } from "../../db";
import { prisma } from "../../db";
import { Prisma, type DataQualityFlag } from "../../prisma";
import { surfaceSegmentDetailsSchema } from "../../schemas/dataQualityRecordChecks";
import { zoneOf } from "../../shared/time/zoneOf";
import { createBusRideOnce } from "../../routes/bus";
import { createRailRideOnce } from "../../routes/rail";
import { instantToWallClock } from "../rides/rideEnds";
import { propagateDelete, shareSnapshot } from "../sharing/propagate";
import { restatusTrips } from "../trip/restatusTrips";
import { findSurfaceSegments } from "./checks/surfaceSegment";
import { FindingActionError } from "./findingErrors";
import { loadRecordSnapshot } from "./recordGather";

/**
 * `convert` for a `surface_segment` flag: the flight becomes the rail or bus
 * ride it is, and the flight goes (owner ruling 2026-11-05).
 *
 * The ride is filed through the ordinary create (`createRailRideOnce`), under
 * a client reference derived from the flag, so a conversion that dies between
 * the ride and the flight's removal files nothing twice when it is answered
 * again. Both ends must carry a real position and the departure a certain
 * instant: a ride drawn from a flight with no position would sit at 0°/0°,
 * and that refusal is the user's to see (`noPosition` / `noTime`), not a
 * guess. The conversion has no undo — the flight is deleted, as in `merge`.
 */

export interface Conversion {
  rideType: "rail" | "bus";
  rideId: string;
  /** The flight's trip, re-derived by the caller after the answer commits. */
  tripId: string | null;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

/** A flight end with no coordinates is stored at 0/0 — never a position. */
const hasPosition = (lat: number, lon: number): boolean => !(lat === 0 && lon === 0);

export async function convertSurfaceFlight(flag: DataQualityFlag): Promise<Conversion> {
  const details = surfaceSegmentDetailsSchema.safeParse(flag.details);
  if (!details.success) throw new FindingActionError("staleFinding");
  const { flightId, mode } = details.data;

  // The flag may be hours old: the rule must still name this flight and mode.
  const snapshot = await loadRecordSnapshot(flag.userId);
  const still = findSurfaceSegments(snapshot).find((f) => f.entityId === flightId);
  if (!still || still.kind !== "surface_segment" || still.details.mode !== mode) {
    throw new FindingActionError("staleFinding");
  }
  const record = snapshot.flights.find((f) => f.id === flightId);
  const flight = await prisma.flight.findFirst({ where: { id: flightId, userId: flag.userId } });
  if (!flight || !record) throw new FindingActionError("staleFinding");

  if (!hasPosition(flight.depLat, flight.depLon) || !hasPosition(flight.arrLat, flight.arrLon)) {
    throw new FindingActionError("invalidAction", "noPosition");
  }
  if (!record.departureAt) throw new FindingActionError("invalidAction", "noTime");

  const depZone = zoneOf({ lat: flight.depLat, lon: flight.depLon });
  const arrZone = zoneOf({ lat: flight.arrLat, lon: flight.arrLon });
  const station = (
    name: string | null,
    code: string | null,
    lat: number,
    lon: number
  ): { name: string; lat: number; lon: number } => ({
    name: name ?? code ?? "?",
    lat,
    lon,
  });
  const departureStation = station(
    clean(flight.depName) ?? clean(flight.depIata),
    clean(flight.depIata),
    flight.depLat,
    flight.depLon
  );
  const arrivalStation = station(
    clean(flight.arrName) ?? clean(flight.arrIata),
    clean(flight.arrIata),
    flight.arrLat,
    flight.arrLon
  );
  const shared = {
    operator: clean(flight.operatingAirline)?.slice(0, 100) ?? null,
    departureLocal: instantToWallClock(record.departureAt, depZone),
    arrivalLocal: record.arrivalAt ? instantToWallClock(record.arrivalAt, arrZone) : null,
    seat: clean(flight.seatNumber)?.slice(0, 20) ?? null,
    bookingReference: clean(flight.bookingReference)?.slice(0, 40) ?? null,
    price: flight.price ?? null,
    ...(flight.price !== null && flight.currency ? { currency: flight.currency } : {}),
    notes: flight.notes ?? null,
    tags: flight.tags,
    companions: flight.companions,
    tripId: flight.tripId,
    bookingId: flight.bookingId,
  };
  const clientRef = `dq-surface:${flag.id}`;

  let rideId: string;
  if (mode === "rail") {
    const { result } = await createRailRideOnce(
      flag.userId,
      {
        ...shared,
        trainNumber: clean(flight.flightNumber)?.slice(0, 20) ?? null,
        departureStation,
        arrivalStation,
      },
      clientRef,
      { skipRailAndFly: true }
    );
    rideId = result.data.id;
  } else {
    const { result } = await createBusRideOnce(
      flag.userId,
      {
        ...shared,
        lineName: clean(flight.flightNumber)?.slice(0, 40) ?? null,
        rideKind: "intercity",
        departureStation,
        arrivalStation,
      },
      clientRef
    );
    rideId = result.ride.id;
  }
  return { rideType: mode, rideId, tripId: flight.tripId };
}

/** The flight's removal, inside the answer's transaction — the same writes as DELETE /flights/:id. */
export async function removeConvertedFlight(
  tx: DbTransaction,
  flag: DataQualityFlag,
  tripId: string | null
): Promise<void> {
  const { flightId } = surfaceSegmentDetailsSchema.parse(flag.details);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "flights" WHERE id = ${flightId} FOR UPDATE`);
  const gone = await shareSnapshot(tx, "flight", flightId);
  const removed = await tx.flight.deleteMany({ where: { id: flightId, userId: flag.userId } });
  if (removed.count === 0) throw new FindingActionError("staleFinding");
  await propagateDelete(tx, flag.userId, gone);
  // The flight stretched its trip's span; the ride that replaces it may not.
  await restatusTrips([tripId], tx);
}
