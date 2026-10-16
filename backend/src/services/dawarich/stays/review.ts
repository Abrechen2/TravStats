import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { AppError } from "../../../middleware/errorHandler";
import { resolveTimeField } from "../../../shared/time/resolveInput";
import { zoneOf } from "../../../shared/time/zoneOf";
import { visitColumnsFromResolved } from "../../timeModel/visitColumns";
import { recheckAchievements } from "../../../utils/achievements";
import type { StayReview } from "../../../schemas/dawarichStays";
import { venueCategory, VENUE_TYPES, type VenueType } from "../marketVisits/venueTypes";
import { meters } from "./detect";
import { completePlaceAddress } from "../../places/addressBackfill";
import logger from "../../../utils/logger";

async function acceptStayOnce(userId: string, id: string, input: StayReview) {
  let createdPlaceId: string | null = null;
  const outcome = await prisma.$transaction(
    async (tx) => {
      const row = await tx.dawarichStay.findFirst({ where: { id, userId } });
      if (!row) throw new AppError("Finding not found", 404);
      if (row.status === "accepted") return row;
      if (row.status !== "pending")
        throw new AppError("Finding already resolved", 409, "DAWARICH_ALREADY_RESOLVED");
      const claimed = await tx.dawarichStay.updateMany({
        where: { id, userId, status: "pending" },
        data: { status: "accepting" },
      });
      if (!claimed.count)
        throw new AppError("Finding already resolved", 409, "DAWARICH_ALREADY_RESOLVED");
      if (
        input.tripId &&
        !(await tx.trip.findFirst({ where: { id: input.tripId, userId }, select: { id: true } }))
      )
        throw new AppError("Trip not found", 404);
      const evidence = (row.evidence ?? {}) as {
        kind?: string;
        market?: { identity?: string; osmRef?: string; venueType?: VenueType };
      };
      const sameVenue =
        (evidence.kind === "market" || evidence.kind === "venue") &&
        (!evidence.market?.venueType || VENUE_TYPES.includes(evidence.market.venueType)) &&
        input.name === row.name &&
        meters(input, { lat: row.sourceLat, lon: row.sourceLon }) <= 100;
      const osmRef =
        sameVenue && /^((node|way|relation)\/\d+)$/.test(evidence.market?.osmRef ?? "")
          ? `osm:${evidence.market!.osmRef}`
          : null;
      const wikidataId =
        sameVenue && /^wikidata:Q[1-9][0-9]*$/.test(evidence.market?.identity ?? "")
          ? evidence.market!.identity!.slice(9)
          : null;
      let place = input.placeId
        ? await tx.place.findFirst({ where: { id: input.placeId, userId } })
        : null;
      if (input.placeId && !place) throw new AppError("Place not found", 404);
      if (!place && (osmRef || wikidataId))
        place = await tx.place.findFirst({
          where: {
            userId,
            OR: [
              ...(osmRef ? [{ externalRef: osmRef }] : []),
              ...(wikidataId ? [{ wikidataId }] : []),
            ],
          },
        });
      // A second finding may have been accepted since the scan. Reuse an own
      // nearby place of the same name before making another copy.
      if (!place) {
        const same = await tx.place.findMany({ where: { userId, name: input.name } });
        place = same.find((p) => meters(p, input) <= 100) ?? null;
      }
      const location = place ?? input;
      const zone = zoneOf(location);
      const options = { userId, placeZone: () => zone, legacyFakeUtc: true, viaToken: false };
      const start = visitColumnsFromResolved(
        await resolveTimeField(input.startAt, { ...options, field: "startAt" })
      );
      const end = visitColumnsFromResolved(
        await resolveTimeField(input.endAt, { ...options, field: "endAt" })
      );
      if (
        !start.visitedAtUtc ||
        !end.visitedAtUtc ||
        end.visitedAtUtc <= start.visitedAtUtc ||
        end.visitedAtUtc.getTime() > Date.now() + 60_000
      )
        throw new AppError("Invalid stay interval", 400, "DAWARICH_INVALID_INTERVAL");
      if (!place) {
        place = await tx.place.create({
          data: {
            userId,
            name: input.name,
            lat: input.lat,
            lon: input.lon,
            category: sameVenue ? venueCategory(evidence.market?.venueType ?? "market") : "other",
            ...(sameVenue ? { externalRef: osmRef, wikidataId } : {}),
            dataSource: "dawarich",
            visited: true,
          },
        });
        createdPlaceId = place.id;
      }
      const dayStart = new Date(start.visitedAt!.toISOString().slice(0, 10) + "T00:00:00Z");
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      // A minute-precise visit is reused only inside this interval. A day-only
      // record can represent the same visit; two separate stops that day remain two.
      const prior = await tx.dawarichStay.findFirst({
        where: {
          userId,
          placeId: place.id,
          status: "accepted",
          startAt: { lte: end.visitedAtUtc },
          endAt: { gte: start.visitedAtUtc },
          visitId: { not: null },
        },
        select: { visitId: true },
      });
      const existing = await tx.placeVisit.findFirst({
        where: {
          userId,
          placeId: place.id,
          OR: [
            ...(prior?.visitId ? [{ id: prior.visitId }] : []),
            { visitedAtUtc: null, visitedAt: { gte: start.visitedAt!, lte: end.visitedAt! } },
            {
              visitedAtUtc: {
                gte: new Date(start.visitedAtUtc.getTime() - (sameVenue ? 600000 : 0)),
                lte: new Date(end.visitedAtUtc.getTime() + (sameVenue ? 600000 : 0)),
              },
            },
            { visitedPrecision: "day", visitedAt: { gte: dayStart, lt: dayEnd } },
          ],
        },
        orderBy: { visitedAtUtc: "asc" },
      });
      if (existing?.tripId && input.tripId && existing.tripId !== input.tripId)
        throw new AppError(
          "Existing visit belongs to another trip",
          409,
          "DAWARICH_VISIT_TRIP_CONFLICT"
        );
      const visit =
        existing ??
        (await tx.placeVisit.create({
          data: {
            userId,
            placeId: place.id,
            tripId: input.tripId,
            ...start,
            writtenVia: "suggestion",
          },
        }));
      if (existing && !existing.tripId && input.tripId)
        await tx.placeVisit.update({ where: { id: existing.id }, data: { tripId: input.tripId } });
      await tx.place.update({ where: { id: place.id }, data: { visited: true } });
      return tx.dawarichStay.update({
        where: { id },
        data: {
          status: "accepted",
          resolvedAt: new Date(),
          visitId: visit.id,
          placeId: place.id,
          tripId: visit.tripId ?? input.tripId,
          name: place.name,
          lat: place.lat,
          lon: place.lon,
          zone: zone!,
          startAt: start.visitedAtUtc,
          endAt: end.visitedAtUtc,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  // A place made here had no country, so an accepted stay never reached the
  // passport or the country filter. Its address comes from the pin the way the
  // place form's does — after the commit, because the geocoder is a network call.
  if (createdPlaceId) await completeAcceptedPlace(createdPlaceId);
  await recheckAchievements(userId, "Dawarich stay accepted");
  return outcome;
}

async function completeAcceptedPlace(placeId: string): Promise<void> {
  try {
    await completePlaceAddress(placeId);
  } catch (err) {
    // The stay is accepted either way; the place backfill retries the address.
    logger.warn(
      { operation: "dawarich_stay_place_address_failed", placeId, err },
      "Address of an accepted Dawarich place could not be completed"
    );
  }
}

export async function rejectStay(userId: string, id: string) {
  const result = await prisma.dawarichStay.updateMany({
    where: { id, userId, status: "pending" },
    data: { status: "rejected", resolvedAt: new Date() },
  });
  if (!result.count) {
    const row = await prisma.dawarichStay.findFirst({ where: { id, userId } });
    if (!row) throw new AppError("Finding not found", 404);
    if (row.status !== "rejected")
      throw new AppError("Finding already resolved", 409, "DAWARICH_ALREADY_RESOLVED");
  }
}

/** Retry a serialization collision; a simultaneous acceptance then reads the same visit. */
export async function acceptStay(userId: string, id: string, input: StayReview) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await acceptStayOnce(userId, id, input);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034")
        throw error;
    }
  }
  throw new AppError("Concurrent review; retry", 409, "DAWARICH_ALREADY_RESOLVED");
}
