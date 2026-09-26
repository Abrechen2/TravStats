import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { TRIP_COLORS } from "../../schemas/trip";
import { deriveTripStatus } from "../../shared/statusDerivation";
import { classifyVisit } from "../../shared/placeCounting";
import { recheckAchievements } from "../../utils/achievements";
import { recomputeTripStatus } from "../tripStatusService";
import { invalidateTripSuggestions } from "./engine";
import { dayColumn as dayDate } from "./time";
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
  ]);
  const linked = counts.reduce((n, c) => n + (c?.count ?? 0), 0);
  if (linked !== members.length) throw staleError();
  return linked;
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
        destinationLabel: proposal.destination,
        status:
          deriveTripStatus({ earliestStart: dayDate(startDay), latestEnd: dayDate(endDay) }) ??
          undefined,
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
        data: { startDate: dayDate(startDay), endDate: dayDate(endDay) },
      });
    }
  }
  const linked = await linkMembers(tx, userId, tripId, members);
  await recordAnswer(tx, userId, proposal, "accepted", { createdTripId: tripId });
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
    select: { id: true, visited: true },
  });
  if (!place) throw staleError();
  // The anchor's trip, when it still is the user's: a visit made during a stay
  // on a trip belongs to that trip.
  const tripId = proposal.anchor?.tripId
    ? ((
        await tx.trip.findFirst({
          where: { id: proposal.anchor.tripId, userId },
          select: { id: true },
        })
      )?.id ?? null)
    : null;
  const visitedAt = dayDate(edits.visitDay ?? proposal.startDay);
  const visit = await tx.placeVisit.create({
    data: { placeId: place.id, userId, tripId, visitedAt },
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
    memberKeys: proposal.members.map((m) => m.key),
    createdTripId: created.createdTripId ?? null,
    createdPlaceVisitId: created.createdPlaceVisitId ?? null,
  };
  await tx.tripSuggestionDecision.upsert({
    where: { userId_fingerprint: { userId, fingerprint: proposal.id } },
    create: { userId, fingerprint: proposal.id, ...data },
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
