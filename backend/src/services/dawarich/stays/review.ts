import { prisma, type DbTransaction } from "../../../db";
import { Prisma, type DawarichStay } from "../../../prisma";
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
import { acceptFlow, type ClaimStore } from "../../locationEvidence/acceptFlow";
import { recheckFinding } from "../../locationEvidence/recheck";

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
      const applied = await applyStayAcceptance(tx, userId, row, input);
      createdPlaceId = applied.createdPlaceId;
      return applied.row;
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

/**
 * What accepting a finding writes, inside the caller's transaction: the place
 * (found or made), the visit (reused or made), and the finding itself as
 * accepted. One body for both providers — a Dawarich finding through
 * `acceptStayOnce`, a TravTrack one through the accept protocol (E4), which
 * also names the finding on the visit and clears its claim.
 */
export async function applyStayAcceptance(
  tx: DbTransaction,
  userId: string,
  row: DawarichStay,
  input: StayReview,
  extra: { suggestionRef?: string | null; clearClaim?: boolean } = {}
): Promise<{ row: DawarichStay; createdPlaceId: string | null }> {
  const id = row.id;
  let createdPlaceId: string | null = null;
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
        OR: [...(osmRef ? [{ externalRef: osmRef }] : []), ...(wikidataId ? [{ wikidataId }] : [])],
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
        // The finding that made it (TravTrack plan E4): never its own cover.
        ...(extra.suggestionRef ? { suggestionRef: extra.suggestionRef } : {}),
      },
    }));
  if (existing && !existing.tripId && input.tripId)
    await tx.placeVisit.update({ where: { id: existing.id }, data: { tripId: input.tripId } });
  await tx.place.update({ where: { id: place.id }, data: { visited: true } });
  const updated = await tx.dawarichStay.update({
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
      ...(extra.clearClaim ? { claimToken: null, claimedAt: null } : {}),
    },
  });
  return { row: updated, createdPlaceId };
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
  await prisma.$transaction(async (tx) => {
    const result = await tx.dawarichStay.updateMany({
      where: { id, userId, status: "pending" },
      data: { status: "rejected", resolvedAt: new Date() },
    });
    if (!result.count) {
      const row = await tx.dawarichStay.findFirst({ where: { id, userId } });
      if (!row) throw new AppError("Finding not found", 404);
      if (row.status !== "rejected")
        throw new AppError("Finding already resolved", 409, "DAWARICH_ALREADY_RESOLVED");
      return;
    }
    // A venue suggestion replaced the plain stays it grew out of. Rejecting the
    // venue used to leave them `superseded` for good — the stays vanished from
    // the inbox and no later scan offered them again.
    const row = await tx.dawarichStay.findFirst({
      where: { id, userId },
      select: { evidence: true },
    });
    const replaced = (row?.evidence as { supersededFindingIds?: unknown } | null)
      ?.supersededFindingIds;
    const ids = Array.isArray(replaced)
      ? replaced.filter((v): v is string => typeof v === "string")
      : [];
    if (ids.length)
      await tx.dawarichStay.updateMany({
        where: { userId, id: { in: ids }, status: "superseded" },
        data: { status: "pending", resolvedAt: null },
      });
  });
}

/** A TravTrack stay finding as the accept protocol claims, re-checks and publishes it. */
function stayClaimStore(userId: string): ClaimStore<DawarichStay, DawarichStay> {
  return {
    resolvedCode: "DAWARICH_ALREADY_RESOLVED",
    find: (id) => prisma.dawarichStay.findFirst({ where: { id, userId } }),
    async claim(id, token, now, staleBefore) {
      const taken = await prisma.dawarichStay.updateMany({
        where: {
          id,
          userId,
          provider: "travtrack",
          OR: [{ status: "pending" }, { status: "accepting", claimedAt: { lt: staleBefore } }],
        },
        data: { status: "accepting", claimToken: token, claimedAt: now },
      });
      return taken.count === 1;
    },
    async holdsClaim(tx, id, token) {
      return !!(await tx.dawarichStay.findFirst({
        where: { id, userId, status: "accepting", claimToken: token },
        select: { id: true },
      }));
    },
    async invalidate(tx, id, token) {
      await tx.dawarichStay.updateMany({
        where: { id, userId, status: "accepting", claimToken: token },
        data: { status: "invalidated", resolvedAt: new Date(), claimToken: null, claimedAt: null },
      });
    },
    async release(id, token) {
      await prisma.dawarichStay.updateMany({
        where: { id, userId, status: "accepting", claimToken: token },
        data: { status: "pending", claimToken: null, claimedAt: null },
      });
    },
    replay: (row) => row,
  };
}

/**
 * A TravTrack finding (TravTrack plan E4): claimed, re-checked against the
 * history as it is now, and published under the TravTrack lock — the visit
 * names the finding (`suggestion_ref`), so it never covers it.
 */
async function acceptTravTrackStay(userId: string, id: string, input: StayReview) {
  let createdPlaceId: string | null = null;
  const outcome = await acceptFlow({
    userId,
    id,
    store: stayClaimStore(userId),
    recheck: (row) => recheckFinding(userId, row),
    apply: async (tx, row) => {
      const applied = await applyStayAcceptance(tx, userId, row, input, {
        suggestionRef: row.evidenceKey,
        clearClaim: true,
      });
      createdPlaceId = applied.createdPlaceId;
      return applied.row;
    },
  });
  if (createdPlaceId) await completeAcceptedPlace(createdPlaceId);
  await recheckAchievements(userId, "TravTrack stay accepted");
  return outcome;
}

/**
 * Retry a serialization collision; a simultaneous acceptance then reads the
 * same visit. A TravTrack finding goes through the accept protocol instead; a
 * Dawarich one is accepted exactly as before (open owner decision (b): no
 * re-check of Dawarich evidence).
 */
export async function acceptStay(userId: string, id: string, input: StayReview) {
  const source = await prisma.dawarichStay.findFirst({
    where: { id, userId },
    select: { provider: true },
  });
  if (source?.provider === "travtrack") return acceptTravTrackStay(userId, id, input);
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
