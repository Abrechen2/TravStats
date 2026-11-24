import { prisma, type DbTransaction } from "../../../db";
import { Prisma, type DawarichStay } from "../../../prisma";
import { AppError } from "../../../middleware/errorHandler";
import { resolveTimeField } from "../../../shared/time/resolveInput";
import { zoneOf } from "../../../shared/time/zoneOf";
import { visitColumnsFromResolved } from "../../timeModel/visitColumns";
import { recheckAchievements } from "../../../utils/achievements";
import type { StayReview } from "../../../schemas/dawarichStays";
import { PLACE_CATEGORIES } from "../../../shared/placeCategories";
import { venueCategory, VENUE_TYPES, type VenueType } from "../marketVisits/venueTypes";
import { meters } from "./detect";
import { takeStayAcceptLock } from "./acceptLock";
import { takeTravTrackLock } from "../../travtrack/lock";
import { completePlaceAddress } from "../../places/addressBackfill";
import logger from "../../../utils/logger";
import { acceptFlow, disabled, type ClaimStore } from "../../locationEvidence/acceptFlow";
import { travTrackInstanceOn, travTrackInstanceOnIn } from "../../travtrack/availability";
import { recheckFinding } from "../../locationEvidence/recheck";
import { scheduleVisitAutoLink } from "../../places/visitPhotoAutoLink";
import { applyBrandMatches } from "../../places/brandRules";

/** The purpose the accept writes: the dialog's choice, else what the finding suggested. */
function purposeOf(input: StayReview, evidence: unknown): "private" | "business" | null {
  if (input.purpose !== undefined) return input.purpose;
  const suggested = (evidence as { suggestedPurpose?: unknown } | null)?.suggestedPurpose;
  return suggested === "private" || suggested === "business" ? suggested : null;
}

async function acceptStayOnce(userId: string, id: string, input: StayReview) {
  let createdPlaceId: string | null = null;
  const outcome = await prisma.$transaction(
    async (tx) => {
      // The account's accepts, of either provider, one at a time (acceptLock.ts).
      await takeStayAcceptLock(tx, userId);
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
    // READ COMMITTED under the lock: Serializable took its snapshot before the
    // lock wait and read places the other accept had just made as missing.
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
  // A place made here had no country, so an accepted stay never reached the
  // passport or the country filter. Its address comes from the pin the way the
  // place form's does — after the commit, because the geocoder is a network call.
  if (createdPlaceId) await completeAcceptedPlace(createdPlaceId);
  await recheckAchievements(userId, "Dawarich stay accepted");
  if (outcome.visitId) scheduleVisitAutoLink(userId, outcome.visitId);
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
  extra: { suggestionRef?: string | null; claimToken?: string; createdBy?: string } = {}
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
    /** A TravTrack stop's venue (`travtrack/visits`): its OSM id and category ride into the new place. */
    visit?: { venue?: { name?: string; osmRef?: string | null; category?: string } };
  };
  const sameVenue =
    (evidence.kind === "market" || evidence.kind === "venue") &&
    (!evidence.market?.venueType || VENUE_TYPES.includes(evidence.market.venueType)) &&
    input.name === row.name &&
    meters(input, { lat: row.sourceLat, lon: row.sourceLon }) <= 100;
  // The venue a stop suggestion named, accepted as named and where it was put.
  const visitVenue =
    evidence.visit?.venue &&
    evidence.visit.venue.name === input.name &&
    input.name === row.name &&
    meters(input, { lat: row.lat, lon: row.lon }) <= 100
      ? evidence.visit.venue
      : null;
  const osmRef =
    sameVenue && /^((node|way|relation)\/\d+)$/.test(evidence.market?.osmRef ?? "")
      ? `osm:${evidence.market!.osmRef}`
      : visitVenue && /^((node|way|relation)\/\d+)$/.test(visitVenue.osmRef ?? "")
        ? `osm:${visitVenue.osmRef}`
        : null;
  const wikidataId =
    sameVenue && /^wikidata:Q[1-9][0-9]*$/.test(evidence.market?.identity ?? "")
      ? evidence.market!.identity!.slice(9)
      : null;
  // A plugin suggestion the finding really carries (never a reference the client made up).
  const pluginRef =
    input.pluginRef &&
    Array.isArray((row.evidence as { plugins?: unknown } | null)?.plugins) &&
    (row.evidence as { plugins: { pluginId?: string; externalRef?: string }[] }).plugins.some(
      (p) =>
        p.pluginId === input.pluginRef!.pluginId && p.externalRef === input.pluginRef!.externalRef
    )
      ? `plugin:${input.pluginRef.pluginId}:${input.pluginRef.externalRef}`
      : null;
  let place = input.placeId
    ? await tx.place.findFirst({ where: { id: input.placeId, userId } })
    : null;
  if (!place && pluginRef)
    place = await tx.place.findFirst({ where: { userId, externalRef: pluginRef } });
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
        category: sameVenue
          ? venueCategory(evidence.market?.venueType ?? "market")
          : visitVenue &&
              (PLACE_CATEGORIES as readonly string[]).includes(visitVenue.category ?? "")
            ? (visitVenue.category as string)
            : "other",
        ...(sameVenue || visitVenue ? { externalRef: osmRef, wikidataId } : {}),
        ...(pluginRef ? { externalRef: pluginRef } : {}),
        dataSource: "dawarich",
        visited: true,
        ...(extra.createdBy ? { createdBy: extra.createdBy } : {}),
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
        ...(purposeOf(input, row.evidence) ? { purpose: purposeOf(input, row.evidence) } : {}),
        ...(extra.createdBy ? { createdBy: extra.createdBy } : {}),
        // The finding that made it (TravTrack plan E4): never its own cover.
        ...(extra.suggestionRef ? { suggestionRef: extra.suggestionRef } : {}),
      },
    }));
  if (existing && !existing.tripId && input.tripId)
    await tx.placeVisit.update({ where: { id: existing.id }, data: { tripId: input.tripId } });
  // A visit already there keeps the purpose its owner set; an explicit choice in the dialog wins.
  const purpose = purposeOf(input, row.evidence);
  // An explicit choice (null included: "deliberately unknown") is written as chosen.
  if (existing && (input.purpose !== undefined || (purpose && existing.purpose === null)))
    await tx.placeVisit.update({ where: { id: existing.id }, data: { purpose } });
  // An automatic acceptance remembers whether it is what made the place visited, so undoing it
  // reverses exactly that and never a flag the owner had set (brandRules.undoAutoAccepted).
  const promotedVisited = !!extra.createdBy && (createdPlaceId !== null || !place.visited);
  await tx.place.update({ where: { id: place.id }, data: { visited: true } });
  // Smart lists: the place joins every list whose rule matched this stop.
  await applyBrandMatches(tx, userId, row.evidence, place.id, extra.createdBy ?? null);
  const accepted = {
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
    // The matched calendar event shrinks to its source, keyed UID and span in the database
    // itself (trigger `dawarich_stays_shrink_calendar`), on this and every other status change.
    ...(promotedVisited
      ? {
          evidence: {
            ...((row.evidence ?? {}) as Record<string, unknown>),
            promotedVisited: true,
          } as unknown as Prisma.InputJsonValue,
        }
      : {}),
  };
  if (extra.claimToken === undefined) {
    const updated = await tx.dawarichStay.update({ where: { id }, data: accepted });
    return { row: updated, createdPlaceId };
  }
  // The accept protocol (E4): only the holder of the claim may finish it. A
  // claim taken over meanwhile aborts the whole transaction — no place, no
  // visit, the other request's claim untouched.
  const finished = await tx.dawarichStay.updateMany({
    where: { id, userId, status: "accepting", claimToken: extra.claimToken },
    data: { ...accepted, claimToken: null, claimedAt: null },
  });
  if (finished.count !== 1)
    throw new AppError("This suggestion is being accepted", 409, "SUGGESTION_ACCEPT_IN_PROGRESS");
  return { row: await tx.dawarichStay.findUniqueOrThrow({ where: { id } }), createdPlaceId };
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
    // A TravTrack finding is rejected under the account's TravTrack lock,
    // taken before any row (lock order (1) in `acceptFlow.ts`): a removal (E5)
    // holds that lock while it deletes venues and hands their fragments back,
    // so the two can never lock a venue and its fragments in opposite orders
    // (Codex review). A plain read, no row lock; a Dawarich finding is
    // rejected exactly as before.
    const source = await tx.dawarichStay.findFirst({
      where: { id, userId },
      select: { provider: true },
    });
    if (source?.provider === "travtrack") await takeTravTrackLock(tx, userId);
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
  const find = (id: string) => prisma.dawarichStay.findFirst({ where: { id, userId } });
  // E4: a stay is accepted while the instance's TravTrack is on.
  const gate = async () => {
    if (!(await travTrackInstanceOn())) throw disabled();
  };
  return {
    resolvedCode: "DAWARICH_ALREADY_RESOLVED",
    find,
    assertAllowed: gate,
    async assertAllowedIn(tx) {
      if (!(await travTrackInstanceOnIn(tx))) throw disabled();
    },
    async claim(id, token, staleBefore) {
      const taken = await prisma.dawarichStay.updateMany({
        where: {
          id,
          userId,
          provider: "travtrack",
          OR: [{ status: "pending" }, { status: "accepting", claimedAt: { lt: staleBefore } }],
        },
        data: { status: "accepting", claimToken: token, claimedAt: new Date() },
      });
      // Ours now: nothing changes a claimed row but a stale takeover two minutes on.
      return taken.count === 1 ? find(id) : null;
    },
    // Every stay accept of the account, Dawarich's too, one at a time (lock order (2)).
    lock: (tx) => takeStayAcceptLock(tx, userId),
    async holdsClaim(tx, id, token) {
      const [row] = await tx.$queryRaw<{ status: string; claim_token: string | null }[]>`
        SELECT status, claim_token FROM dawarich_stays
        WHERE id = ${id} AND user_id = ${userId}
        FOR UPDATE`;
      if (!row) return "gone";
      return row.status === "accepting" && row.claim_token === token ? "held" : "lost";
    },
    async invalidate(tx, { id }, token) {
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
async function acceptTravTrackStay(
  userId: string,
  id: string,
  input: StayReview,
  createdBy?: string
) {
  let createdPlaceId: string | null = null;
  const outcome = await acceptFlow({
    userId,
    id,
    store: stayClaimStore(userId),
    recheck: (row) => recheckFinding(userId, row),
    apply: async (tx, row, token) => {
      const applied = await applyStayAcceptance(tx, userId, row, input, {
        suggestionRef: row.evidenceKey,
        claimToken: token,
        createdBy,
      });
      createdPlaceId = applied.createdPlaceId;
      return applied.row;
    },
  });
  if (createdPlaceId) await completeAcceptedPlace(createdPlaceId);
  await recheckAchievements(userId, "TravTrack stay accepted");
  if (outcome.visitId) scheduleVisitAutoLink(userId, outcome.visitId);
  return outcome;
}

/**
 * Retry a serialization collision; a simultaneous acceptance then reads the
 * same visit. A TravTrack finding goes through the accept protocol instead; a
 * Dawarich one is accepted exactly as before (open owner decision (b): no
 * re-check of Dawarich evidence).
 */
export async function acceptStay(
  userId: string,
  id: string,
  input: StayReview,
  options: { createdBy?: string } = {}
) {
  const source = await prisma.dawarichStay.findFirst({
    where: { id, userId },
    select: { provider: true },
  });
  // No row: the answer stays the code-less 404 it always was (owner decision
  // 2026-10-25) — a missing row names no provider, and a Dawarich client must
  // read exactly what it read before. `SUGGESTION_NOT_FOUND` belongs to a
  // TravTrack row, which the protocol answers when the row goes mid-accept (E5).
  if (!source) throw new AppError("Finding not found", 404);
  if (source.provider === "travtrack")
    return acceptTravTrackStay(userId, id, input, options.createdBy);
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
