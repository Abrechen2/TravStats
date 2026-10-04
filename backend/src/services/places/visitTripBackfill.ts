/**
 * Apply the trip-by-date rule (`visitTrip.ts`) to visits stored WITHOUT a trip
 * (forgejo#199) — the Companion's "Ort jetzt" visits from Seoul, saved before
 * the rule existed, sit outside the one trip their day falls in.
 *
 * A REVIEW tool first: the owner reads the list before anything is written.
 * The column cannot tell "nobody said" from "the user said no trip" for an
 * old row — both are NULL — so a proposal here is exactly that, a proposal.
 * Only `apply` writes, and only the proposals listed.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { loadTripSpans, tripsForDay, visitLocalDay } from "./visitTrip";

export interface VisitTripProposal {
  visitId: string;
  userId: string;
  placeName: string;
  day: string;
  tripId: string;
  tripName: string;
}

export interface VisitTripReport {
  apply: boolean;
  scanned: number;
  proposals: VisitTripProposal[];
  /** Visits whose day cannot be known (no zone, or dated only to a month). */
  undated: number;
  /** A day no trip spans. */
  noTrip: number;
  /** A day several trips span — the user's choice, not ours. */
  severalTrips: number;
}

export async function assignVisitTrips(opts: {
  apply: boolean;
  userId?: string;
}): Promise<VisitTripReport> {
  const visits = await prisma.placeVisit.findMany({
    where: { tripId: null, ...(opts.userId ? { userId: opts.userId } : {}) },
    select: {
      id: true,
      userId: true,
      visitedAtUtc: true,
      visitedZone: true,
      visitedPrecision: true,
      place: { select: { name: true } },
    },
    orderBy: [{ userId: "asc" }, { visitedAtUtc: "asc" }, { id: "asc" }],
  });

  const report: VisitTripReport = {
    apply: opts.apply,
    scanned: visits.length,
    proposals: [],
    undated: 0,
    noTrip: 0,
    severalTrips: 0,
  };
  const tripsByUser = new Map<string, Awaited<ReturnType<typeof loadTripSpans>>>();

  for (const visit of visits) {
    const day = visitLocalDay(visit);
    if (!day) {
      report.undated += 1;
      continue;
    }
    let trips = tripsByUser.get(visit.userId);
    if (!trips) {
      trips = await loadTripSpans(prisma, visit.userId);
      tripsByUser.set(visit.userId, trips);
    }
    const spanning = tripsForDay(day, trips);
    if (spanning.length !== 1) {
      if (spanning.length > 1) report.severalTrips += 1;
      else report.noTrip += 1;
      continue;
    }
    report.proposals.push({
      visitId: visit.id,
      userId: visit.userId,
      placeName: visit.place.name,
      day,
      tripId: spanning[0].id,
      tripName: spanning[0].name,
    });
  }

  if (opts.apply) {
    for (const p of report.proposals) {
      // `tripId: null` in the WHERE: a visit filed meanwhile is left as it is.
      await prisma.placeVisit.updateMany({
        where: { id: p.visitId, userId: p.userId, tripId: null },
        data: { tripId: p.tripId },
      });
    }
  }

  logger.info(
    {
      operation: "visit_trip_backfill",
      apply: opts.apply,
      scanned: report.scanned,
      proposed: report.proposals.length,
      undated: report.undated,
      noTrip: report.noTrip,
      severalTrips: report.severalTrips,
    },
    "Visit trip backfill finished"
  );
  return report;
}
