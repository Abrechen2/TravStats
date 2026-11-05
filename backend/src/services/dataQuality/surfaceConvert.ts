import type { DbTransaction } from "../../db";
import { prisma } from "../../db";
import { Prisma, type DataQualityFlag } from "../../prisma";
import { surfaceSegmentDetailsSchema } from "../../schemas/dataQualityRecordChecks";
import { zoneOf } from "../../shared/time/zoneOf";
import { prepareBusRide } from "../../routes/bus";
import { prepareRailRide } from "../../routes/rail";
import { instantToWallClock, wallClockToInstant } from "../rides/rideEnds";
import { propagateDelete, shareSnapshot } from "../sharing/propagate";
import { restatusTrips } from "../trip/restatusTrips";
import { findSurfaceSegments } from "./checks/surfaceSegment";
import { FindingActionError } from "./findingErrors";
import { loadRecordSnapshot } from "./recordGather";

/**
 * `convert` for a `surface_segment` flag: the flight becomes the rail or bus
 * ride it is, and the flight goes (owner ruling 2026-11-05).
 *
 * Everything slow or external (reading the flight, the record check, the
 * ride's stations, geometry and FX) happens first, outside any transaction, from
 * ONE read of the flight at version V. Then a single transaction locks the
 * flight, checks it is still at V (else `staleFinding`, nothing written),
 * files the ride, moves the originals, deletes the flight — and the caller
 * resolves the finding in that same transaction. Commit or nothing: a failed
 * answer leaves the flight and no ride, so a retry needs no memory of the
 * earlier attempt. Both ends must carry a real position and the departure a
 * certain instant (`noPosition` / `noTime`). The conversion has no undo.
 */

export interface Conversion {
  rideType: "rail" | "bus";
  rideId: string;
}

/** A conversion with the slow work done: `commit` is the database part only. */
export interface PreparedConversion {
  commit: (tx: DbTransaction) => Promise<Conversion>;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

/** A flight end with no coordinates is stored at 0/0 — never a position. */
const hasPosition = (lat: number, lon: number): boolean => !(lat === 0 && lon === 0);

export async function prepareSurfaceConversion(flag: DataQualityFlag): Promise<PreparedConversion> {
  const details = surfaceSegmentDetailsSchema.safeParse(flag.details);
  if (!details.success) throw new FindingActionError("staleFinding");
  const { flightId, mode } = details.data;

  // The version the payload is drawn from is read BEFORE the snapshot and
  // checked again after it: an edit in between is `staleFinding`, never a
  // ride with the old times that then deletes the edited flight.
  const flight = await prisma.flight.findFirst({ where: { id: flightId, userId: flag.userId } });
  // The flag may be hours old: the rule must still name this flight and mode.
  const snapshot = await loadRecordSnapshot(flag.userId);
  const still = findSurfaceSegments(snapshot).find((f) => f.entityId === flightId);
  if (!still || still.kind !== "surface_segment" || still.details.mode !== mode) {
    throw new FindingActionError("staleFinding");
  }
  const record = snapshot.flights.find((f) => f.id === flightId);
  const reread = await prisma.flight.findFirst({
    where: { id: flightId, userId: flag.userId },
    select: { updatedAt: true },
  });
  if (!flight || !record || reread?.updatedAt.getTime() !== flight.updatedAt.getTime()) {
    throw new FindingActionError("staleFinding");
  }

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
  // An instant read back as a wall clock is ambiguous in the autumn hour that
  // happens twice; name the later occurrence when the earlier one is not it.
  const foldOf = (wall: string, zone: string | null, instant: Date): "later" | null =>
    // Minute precision: the wall clock carries no seconds.
    Math.floor(wallClockToInstant(wall, zone).getTime() / 60_000) ===
    Math.floor(instant.getTime() / 60_000)
      ? null
      : "later";
  const departureLocal = instantToWallClock(record.departureAt, depZone);
  const arrivalLocal = record.arrivalAt ? instantToWallClock(record.arrivalAt, arrZone) : null;
  const shared = {
    operator: clean(flight.operatingAirline)?.slice(0, 100) ?? null,
    departureLocal,
    arrivalLocal,
    departureFold: foldOf(departureLocal, depZone, record.departureAt),
    arrivalFold:
      arrivalLocal && record.arrivalAt ? foldOf(arrivalLocal, arrZone, record.arrivalAt) : null,
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
  const body =
    mode === "rail"
      ? {
          ...shared,
          trainNumber: clean(flight.flightNumber)?.slice(0, 20) ?? null,
          departureStation,
          arrivalStation,
        }
      : {
          ...shared,
          lineName: clean(flight.flightNumber)?.slice(0, 40) ?? null,
          rideKind: "intercity",
          departureStation,
          arrivalStation,
        };
  // All validation, station resolution, geometry and FX run here, outside the
  // transaction; a refusal leaves everything as it was.
  const rail =
    mode === "rail" ? await prepareRailRide(flag.userId, body, { skipRailAndFly: true }) : null;
  const bus = mode === "bus" ? await prepareBusRide(flag.userId, body) : null;
  const version = flight.updatedAt;

  return {
    commit: async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "flights" WHERE id = ${flightId} FOR UPDATE`);
      const current = await tx.flight.findFirst({
        where: { id: flightId, userId: flag.userId, updatedAt: version },
        select: { id: true },
      });
      // Edited, converted or deleted since it was read: nothing is written.
      if (!current) throw new FindingActionError("staleFinding");

      const rideId = rail ? (await rail.write(tx)).id : (await bus!.write(tx)).id;
      // The originals filed with the flight (tickets, receipts) go with the
      // entry: deleting the flight would delete them.
      await tx.document.updateMany({
        where: { flightId },
        data: rail
          ? { flightId: null, railJourneyId: rideId }
          : { flightId: null, busJourneyId: rideId },
      });
      const gone = await shareSnapshot(tx, "flight", flightId);
      const removed = await tx.flight.deleteMany({
        where: { id: flightId, userId: flag.userId, updatedAt: version },
      });
      if (removed.count === 0) throw new FindingActionError("staleFinding");
      await propagateDelete(tx, flag.userId, gone);
      // The flight stretched its trip's span; the ride that replaces it may not.
      await restatusTrips([flight.tripId], tx);
      return { rideType: mode, rideId };
    },
  };
}
