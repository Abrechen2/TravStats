import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { TRIP_COLORS } from "../../schemas/trip";
import { statusFromOwnDates } from "../trips/ownDatesStatus";
import { classifyVisit } from "../../shared/placeCounting";
import { recheckAchievements } from "../../utils/achievements";
import { recomputeTripStatus } from "../tripStatusService";
import { invalidateTripSuggestions } from "./engine";
import { proposalId } from "./proposals";
import { dayColumn as dayDate } from "./time";
import { typedTripDays } from "../timeModel/tripColumns";
import { visitColumnsFromDay } from "../timeModel/visitColumns";
import { tripForVisitDay } from "../places/visitTrip";
import type { LinkableDomain, TripSuggestion } from "./types";

/**
 * Answering a trip suggestion. Accepting does everything the proposal promised
 * in ONE transaction — create or widen the trip, link every chosen member, or
 * record the visit — and records the answer in the same one, so a failure half
 * way leaves neither a trip without its entries nor an answer without its trip.
 *
 * Every write is scoped by `userId` in its WHERE, and every link additionally
 * by `tripId: null` (a member someone moved onto another trip in the meantime
 * is not silently re-homed). A count that falls short throws, and the throw is
 * the rollback.
 */

export interface AcceptEdits {
  name?: string;
  startDay?: string;
  endDay?: string;
  /** The members to link — a subset of the proposal's. Default: all. */
  memberKeys?: string[];
  /** place_visit: the day to record. Default: the proposal's. */
  visitDay?: string;
}

export interface AcceptResult {
  tripId: string | null;
  placeVisitId: string | null;
  linked: number;
}

/** A proposal that changed between showing it and answering it. */
export const staleError = (): AppError =>
  new AppError("The suggestion changed; reload the list", 409, "TRIP_SUGGESTION_STALE");

const selectionError = (): AppError =>
  new AppError(
    "The selection must be members of the suggestion",
    400,
    "TRIP_SUGGESTION_SELECTION_INVALID"
  );

type Tx = DbTransaction;

/** Link the chosen members to `tripId`; throws stale when any has moved. */
async function linkMembers(
  tx: Tx,
  userId: string,
  tripId: string,
  members: TripSuggestion["members"]
): Promise<number> {
  const ids = (domain: LinkableDomain): string[] =>
    members.filter((m) => m.domain === domain).map((m) => m.id);
  const where = (domain: LinkableDomain) => ({ id: { in: ids(domain) }, userId, tripId: null });
  const data = { tripId };
  const counts = await Promise.all([
    ids("flight").length ? tx.flight.updateMany({ where: where("flight"), data }) : null,
    ids("rail").length ? tx.railJourney.updateMany({ where: where("rail"), data }) : null,
    ids("cruise").length ? tx.cruise.updateMany({ where: where("cruise"), data }) : null,
    ids("lodging").length ? tx.lodgingStay.updateMany({ where: where("lodging"), data }) : null,
    ids("place").length ? tx.placeVisit.updateMany({ where: where("place"), data }) : null,
    ids("roadtrip").length
      ? tx.tripRoute.updateMany({ where: { ...where("roadtrip"), kind: "roadtrip" }, data })
      : null,
    ids("tour").length ? linkTours(tx, userId, tripId, ids("tour")) : null,
  ]);
  const linked = counts.reduce((n, c) => n + (c?.count ?? 0), 0);
  if (linked !== members.length) throw staleError();
  return linked;
}

/**
 * Day tours join the trip through their own trip link (owner decision
 * 2026-09-26). Only a tour with no trip, whose points are all its own, moves:
 * a section built from a trip's timeline stops belongs to that trip. Each tour
 * is ordered after the trip's existing sections, as `POST /tours` orders a new
 * one, so the trip's route list keeps a total order.
 */
async function linkTours(
  tx: Tx,
  userId: string,
  tripId: string,
  tourIds: readonly string[]
): Promise<{ count: number }> {
  const last = await tx.tripRoute.findFirst({
    where: { userId, tripId },
    orderBy: { orderIdx: "desc" },
    select: { orderIdx: true },
  });
  let orderIdx = last ? last.orderIdx + 1 : 0;
  let count = 0;
  for (const id of tourIds) {
    const moved = await tx.tripRoute.updateMany({
      where: {
        id,
        userId,
        kind: "tour",
        tripId: null,
        stops: { none: { tripId: { not: null } } },
      },
      data: { tripId, orderIdx },
    });
    count += moved.count;
    orderIdx += 1;
  }
  return { count };
}

function chosenMembers(proposal: TripSuggestion, edits: AcceptEdits): TripSuggestion["members"] {
  if (edits.memberKeys === undefined) return proposal.members;
  const wanted = new Set(edits.memberKeys);
  const chosen = proposal.members.filter((m) => wanted.has(m.key));
  if (chosen.length !== wanted.size || chosen.length === 0) throw selectionError();
  return chosen;
}

async function acceptTrip(
  tx: Tx,
  userId: string,
  proposal: TripSuggestion,
  edits: AcceptEdits
): Promise<AcceptResult> {
  const members = chosenMembers(proposal, edits);
  const startDay = edits.startDay ?? proposal.newSpan?.startDay ?? proposal.startDay;
  const endDay = edits.endDay ?? proposal.newSpan?.endDay ?? proposal.endDay;
  if (endDay < startDay) {
    throw new AppError("End before start", 400, "TRIP_SUGGESTION_SELECTION_INVALID");
  }

  let tripId: string;
  if (proposal.kind === "new_trip") {
    const tripCount = await tx.trip.count({ where: { userId } });
    const name = edits.name?.trim() || proposal.destination || startDay;
    const trip = await tx.trip.create({
      data: {
        userId,
        name,
        color: TRIP_COLORS[tripCount % TRIP_COLORS.length],
        startDate: dayDate(startDay),
        endDate: dayDate(endDay),
        ...typedTripDays({ startDate: dayDate(startDay), endDate: dayDate(endDay) }),
        destinationLabel: proposal.destination,
        status: (await statusFromOwnDates(userId, dayDate(startDay), dayDate(endDay))) ?? undefined,
      },
    });
    tripId = trip.id;
  } else {
    const trip = await tx.trip.findFirst({
      where: { id: proposal.trip?.id, userId },
      select: { id: true, startDate: true, endDate: true },
    });
    if (!trip) throw staleError();
    tripId = trip.id;
    if (proposal.kind === "extend") {
      await tx.trip.update({
        where: { id: trip.id },
        data: {
          startDate: dayDate(startDay),
          endDate: dayDate(endDay),
          ...typedTripDays({ startDate: dayDate(startDay), endDate: dayDate(endDay) }),
        },
      });
    }
  }
  const linked = await linkMembers(tx, userId, tripId, members);
  await recordAnswer(tx, userId, proposal, "accepted", { createdTripId: tripId });
  await recordDeclined(tx, userId, tripId, proposal, members);
  return { tripId, placeVisitId: null, linked };
}

async function acceptVisit(
  tx: Tx,
  userId: string,
  proposal: TripSuggestion,
  edits: AcceptEdits
): Promise<AcceptResult> {
  const place = await tx.place.findFirst({
    where: { id: proposal.place?.id, userId },
    select: { id: true, visited: true, lat: true, lon: true },
  });
  if (!place) throw staleError();
  // A suggestion names a DAY: precision day, on the place's clock (ADR 0002).
  const time = visitColumnsFromDay(edits.visitDay ?? proposal.startDay, place);
  // The anchor's trip, when it still is the user's: a visit made during a stay
  // on a trip belongs to that trip. Without an anchor trip, the visit's day
  // finds the one trip that spans it, as for every other trip-less visit.
  const anchorTripId = proposal.anchor?.tripId
    ? ((
        await tx.trip.findFirst({
          where: { id: proposal.anchor.tripId, userId },
          select: { id: true },
        })
      )?.id ?? null)
    : null;
  const tripId = anchorTripId ?? (await tripForVisitDay(tx, userId, time));
  const visitedAt = time.visitedAt;
  const visit = await tx.placeVisit.create({
    data: { placeId: place.id, userId, tripId, ...time, writtenVia: "suggestion" },
  });
  // The places route's rule: a visit that HAPPENED promotes the place out of
  // the wishlist in the same transaction, a future one never does.
  if (!place.visited && classifyVisit({ visitedAt }) === "visited") {
    await tx.place.update({ where: { id: place.id }, data: { visited: true } });
  }
  await recordAnswer(tx, userId, proposal, "accepted", { createdPlaceVisitId: visit.id });
  return { tripId, placeVisitId: visit.id, linked: 0 };
}

async function recordAnswer(
  tx: Tx,
  userId: string,
  proposal: TripSuggestion,
  status: "accepted" | "dismissed",
  created: { createdTripId?: string; createdPlaceVisitId?: string } = {}
): Promise<void> {
  const data = {
    kind: proposal.kind,
    status,
    targetId: proposal.trip?.id ?? proposal.place?.id ?? null,
    // A visit proposal has no members; its anchor is what the answer settles.
    memberKeys:
      proposal.kind === "place_visit" && proposal.anchor
        ? [proposal.anchor.key]
        : proposal.members.map((m) => m.key),
    createdTripId: created.createdTripId ?? null,
    createdPlaceVisitId: created.createdPlaceVisitId ?? null,
  };
  await tx.tripSuggestionDecision.upsert({
    where: { userId_fingerprint: { userId, fingerprint: proposal.id } },
    create: { userId, fingerprint: proposal.id, ...data },
    update: data,
  });
}

/**
 * Members the user unticked before accepting are an answer too: "not part of
 * this trip" (acceptance D3, 2026-09-26 — a deselected TGV ride came straight
 * back as "Gehört zu einer Reise?" for the trip just created). Recorded as a
 * dismissed link to that trip, so the assign/extend family for the trip leaves
 * them alone until the logbook changes materially (`withoutAnswered`).
 */
async function recordDeclined(
  tx: Tx,
  userId: string,
  tripId: string,
  proposal: TripSuggestion,
  chosen: TripSuggestion["members"]
): Promise<void> {
  const taken = new Set(chosen.map((m) => m.key));
  const declined = proposal.members.filter((m) => !taken.has(m.key)).map((m) => m.key);
  if (declined.length === 0) return;
  const fingerprint = proposalId("assign", tripId, declined);
  const data = {
    kind: "assign",
    status: "dismissed",
    targetId: tripId,
    memberKeys: declined,
    createdTripId: null,
    createdPlaceVisitId: null,
  };
  await tx.tripSuggestionDecision.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    create: { userId, fingerprint, ...data },
    update: data,
  });
}

export async function acceptSuggestion(
  userId: string,
  proposal: TripSuggestion,
  edits: AcceptEdits
): Promise<AcceptResult> {
  const result = await prisma.$transaction(
    (tx) =>
      proposal.kind === "place_visit"
        ? acceptVisit(tx, userId, proposal, edits)
        : acceptTrip(tx, userId, proposal, edits),
    { timeout: 30_000, maxWait: 5_000 }
  );
  invalidateTripSuggestions(userId);
  // Converge the stored status from the newly linked entries, as every other
  // write path that links segments does; then let achievements see the change.
  if (result.tripId) await recomputeTripStatus(result.tripId);
  await recheckAchievements(userId, "trip suggestion accepted");
  return result;
}

export async function dismissSuggestion(userId: string, proposal: TripSuggestion): Promise<void> {
  await prisma.$transaction((tx) => recordAnswer(tx, userId, proposal, "dismissed"));
  invalidateTripSuggestions(userId);
}
