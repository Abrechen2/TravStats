import type { DbTransaction } from "../../db";
import { prisma } from "../../db";
import { Prisma, type DataQualityFlag } from "../../prisma";
import { surfaceSegmentDetailsSchema } from "../../schemas/dataQualityRecordChecks";
import { zoneOf } from "../../shared/time/zoneOf";
import { payloadHash } from "../sync/clientRef";
import { createBusRideOnce } from "../../routes/bus";
import { createRailRideOnce } from "../../routes/rail";
import { instantToWallClock, wallClockToInstant } from "../rides/rideEnds";
import { propagateDelete, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
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
  /** The flight as it was read; the removal refuses a flight edited since. */
  flightUpdatedAt: Date;
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
  // One key per source flight: a retry after a failed removal finds the ride
  // already filed instead of filing a second one.
  const clientRef = `dq-surface:${flightId}`;

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
  // The idempotency record keeps the hash of the body the ride was drawn from,
  // so "is the flight the way the ride was drawn" is a comparison of content,
  // not of clocks: an edit during preparation changes the body, whatever the
  // timestamps say.
  const hash = payloadHash(body);

  const filed = await prisma.clientWriteRef.findFirst({
    where: { userId: flag.userId, clientRef, kind: mode },
    select: { entityId: true, payloadHash: true, entityVersion: true },
  });
  const earlier = filed
    ? mode === "rail"
      ? await prisma.railJourney.findFirst({
          where: { id: filed.entityId, userId: flag.userId },
          select: { id: true, updatedAt: true },
        })
      : await prisma.busJourney.findFirst({
          where: { id: filed.entityId, userId: flag.userId },
          select: { id: true, updatedAt: true },
        })
    : null;

  let rideId: string;
  if (filed && earlier && filed.payloadHash === hash) {
    // Same flight content: the ride already filed is the ride.
    rideId = earlier.id;
  } else {
    if (filed && earlier) {
      // The flight changed since the ride was drawn. The ride is replaced only
      // if nobody touched it: its exact version must be the one recorded right
      // after filing, checked again inside the delete itself.
      if (!filed.entityVersion) throw new FindingActionError("staleFinding");
      await discardStaleRide(flag.userId, mode, {
        rideId: earlier.id,
        rideVersion: filed.entityVersion,
        flightId,
        flightVersion: flight.updatedAt,
        clientRef,
      });
    }
    if (mode === "rail") {
      const { result } = await createRailRideOnce(flag.userId, body, clientRef, {
        skipRailAndFly: true,
        recordVersion: true,
      });
      rideId = result.data.id;
    } else {
      const { result } = await createBusRideOnce(flag.userId, body, clientRef, {
        recordVersion: true,
      });
      rideId = result.ride.id;
    }
  }
  return { rideType: mode, rideId, flightUpdatedAt: flight.updatedAt, tripId: flight.tripId };
}

/**
 * Takes back a ride an earlier attempt filed, with its idempotency key — and
 * only that exact ride: the delete names the version recorded after filing, and
 * the flight is held at the version this attempt read. Either mismatch deletes
 * nothing and refuses.
 */
async function discardStaleRide(
  userId: string,
  mode: "rail" | "bus",
  input: {
    rideId: string;
    rideVersion: Date;
    flightId: string;
    flightVersion: Date;
    clientRef: string;
  }
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "flights" WHERE id = ${input.flightId} FOR UPDATE`
      );
      const flightNow = await tx.flight.findFirst({
        where: { id: input.flightId, userId, updatedAt: input.flightVersion },
        select: { id: true },
      });
      if (!flightNow) throw new FindingActionError("staleFinding");
      const gone = await shareSnapshot(tx, mode, input.rideId);
      const where = { id: input.rideId, userId, updatedAt: input.rideVersion };
      const removed =
        mode === "rail"
          ? await tx.railJourney.deleteMany({ where })
          : await tx.busJourney.deleteMany({ where });
      if (removed.count === 0) throw new FindingActionError("staleFinding");
      await propagateDelete(tx, userId, gone);
      await tx.clientWriteRef.deleteMany({ where: { userId, clientRef: input.clientRef } });
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

/** The flight's removal, inside the answer's transaction — the same writes as DELETE /flights/:id. */
export async function removeConvertedFlight(
  tx: DbTransaction,
  flag: DataQualityFlag,
  conversion: Conversion
): Promise<void> {
  const { flightId } = surfaceSegmentDetailsSchema.parse(flag.details);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "flights" WHERE id = ${flightId} FOR UPDATE`);
  // Edited since the ride was drawn from it: the ride would not carry the edit.
  const current = await tx.flight.findFirst({
    where: { id: flightId, userId: flag.userId },
    select: { updatedAt: true },
  });
  if (!current || current.updatedAt.getTime() !== conversion.flightUpdatedAt.getTime()) {
    throw new FindingActionError("staleFinding");
  }
  // The originals filed with the flight (tickets, receipts) go with the entry:
  // deleting the flight would delete them.
  await tx.document.updateMany({
    where: { flightId },
    data:
      conversion.rideType === "rail"
        ? { flightId: null, railJourneyId: conversion.rideId }
        : { flightId: null, busJourneyId: conversion.rideId },
  });
  const gone = await shareSnapshot(tx, "flight", flightId);
  // Conditional on the exact version the ride was drawn from.
  const removed = await tx.flight.deleteMany({
    where: { id: flightId, userId: flag.userId, updatedAt: conversion.flightUpdatedAt },
  });
  if (removed.count === 0) throw new FindingActionError("staleFinding");
  await propagateDelete(tx, flag.userId, gone);
  // The flight stretched its trip's span; the ride that replaces it may not.
  await restatusTrips([conversion.tripId], tx);
}
