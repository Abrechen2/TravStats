import { prisma } from "../db";
import logger from "../utils/logger";
import {
  FLIGHT_ARRIVAL_SLACK_HOURS,
  FLIGHT_DEPARTURE_SLACK_HOURS,
  CRUISE_SLACK_HOURS,
  deriveTripStatus,
  tripDateBounds,
} from "../shared/statusDerivation";

const H = 60 * 60 * 1000;

/**
 * Hourly convergence sweep (spec 2026-07-17-status-from-dates): makes the
 * stored temporal statuses agree with the dates. Generalizes and replaces
 * the retired one-way flips (transitionZombieFlights, transitionPastCruises).
 * Passthrough statuses (cancelled/historical/duplicated) are never touched.
 *
 * Hysteresis in the slack band: The flown→scheduled revert covers only
 * STRICTLY FUTURE dates (arrival/departure > now), intentionally leaving
 * the FLIGHT_ARRIVAL_SLACK_HOURS band (now-6h to now) untouched. This band
 * is a hysteresis zone: a stored "flown" status is legitimate there
 * (from user/parser-set values at creation/import, direct script/seed writes,
 * or pre-existing data—the pending-update apply path never touches status,
 * and the only automated status writers are the legacy one-way flips this sweep
 * replaces, retired in a follow-up task, whose 6h/30h/48h cutoffs equal these
 * slack constants), and reverting it would fight deliberate data on every hourly
 * sweep. The deriver's "scheduled" return for the whole band applies to WRITE
 * paths; the sweep deliberately does NOT narrow its window to match—only
 * corrects clearly contradictory (future-dated) rows.
 */
export async function sweepStatuses(
  now: Date = new Date()
): Promise<{ flights: number; cruises: number; lodging: number; trips: number }> {
  const arrivalCutoff = new Date(now.getTime() - FLIGHT_ARRIVAL_SLACK_HOURS * H);
  const departureCutoff = new Date(now.getTime() - FLIGHT_DEPARTURE_SLACK_HOURS * H);
  const cruiseCutoff = new Date(now.getTime() - CRUISE_SLACK_HOURS * H);

  // Flights: scheduled -> flown (stale) and flown -> scheduled (future-dated)
  //
  // Split in two on 2026-09-03, over what `nextApiCheckAt` is set to.
  //
  // Clearing it unconditionally is what shut the door: `checkAndUpdate` only
  // looks at flights with a due check, so a leg that landed without its actual
  // times was never asked about again — by anything, ever. Measured on a real
  // account: every long-haul flight, because the two checks that could have
  // captured an arrival both fell on the day AFTER departure and were refused
  // by the free plan's date filter.
  //
  // So a flight that HAS its actual arrival is finished and the field is
  // cleared, as before. One that does not keeps a single late check, and
  // `finalArrivalLookup` clears the field whether that check succeeds or not.
  // "Exactly once" is therefore structural — the same field means "a last
  // attempt is outstanding" — rather than a new column nobody would maintain.
  const staleWhere = {
    status: "scheduled",
    OR: [
      { arrivalTime: { not: null, lt: arrivalCutoff } },
      { arrivalTime: null, departureTime: { not: null, lt: departureCutoff } },
    ],
  };
  const staleComplete = await prisma.flight.updateMany({
    where: { ...staleWhere, NOT: { actualArrival: null } },
    data: { status: "flown", lastModifiedBy: "status_sweep", nextApiCheckAt: null },
  });
  const staleMissingArrival = await prisma.flight.updateMany({
    where: { ...staleWhere, actualArrival: null },
    data: { status: "flown", lastModifiedBy: "status_sweep", nextApiCheckAt: now },
  });
  const staleFlights = {
    count: staleComplete.count + staleMissingArrival.count,
  };
  const futureFlown = await prisma.flight.updateMany({
    where: {
      status: "flown",
      OR: [{ arrivalTime: { gt: now } }, { arrivalTime: null, departureTime: { gt: now } }],
    },
    data: { status: "scheduled", lastModifiedBy: "status_sweep" },
  });

  // Cruises: three-way from start/end (+slack)
  const cruiseToInProgress = await prisma.cruise.updateMany({
    where: {
      status: { in: ["scheduled", "flown"] },
      startDate: { not: null, lte: now },
      endDate: { not: null, gte: cruiseCutoff },
    },
    data: { status: "in_progress" },
  });
  const cruiseToFlown = await prisma.cruise.updateMany({
    where: {
      status: { in: ["scheduled", "in_progress"] },
      OR: [
        { endDate: { not: null, lt: cruiseCutoff } },
        { endDate: null, startDate: { not: null, lt: cruiseCutoff } },
      ],
    },
    data: { status: "flown" },
  });
  const cruiseToScheduled = await prisma.cruise.updateMany({
    where: {
      status: { in: ["flown", "in_progress"] },
      startDate: { gt: now },
    },
    data: { status: "scheduled" },
  });

  // Lodging stays: the same three-way split as cruises, but with NO slack —
  // a check-out is a calendar fact the user typed, not a revisable estimate,
  // and no legacy one-way flip ever wrote this column, so there is no
  // deliberate data for a hysteresis band to protect. Both dates are NOT NULL
  // on this table, which is why these queries need no null branches.
  const lodgingToInProgress = await prisma.lodgingStay.updateMany({
    where: {
      status: { in: ["scheduled", "completed"] },
      checkIn: { lte: now },
      checkOut: { gt: now },
    },
    data: { status: "in_progress" },
  });
  const lodgingToCompleted = await prisma.lodgingStay.updateMany({
    where: {
      status: { in: ["scheduled", "in_progress"] },
      checkOut: { lte: now },
    },
    data: { status: "completed" },
  });
  const lodgingToScheduled = await prisma.lodgingStay.updateMany({
    where: {
      status: { in: ["in_progress", "completed"] },
      checkIn: { gt: now },
    },
    data: { status: "scheduled" },
  });

  // Trips: recompute from segment date bounds, update diffs only
  const trips = await prisma.trip.findMany({
    select: {
      id: true,
      status: true,
      flights: { select: { departureTime: true, arrivalTime: true } },
      cruises: { select: { startDate: true, endDate: true } },
    },
  });
  let tripFlips = 0;
  for (const trip of trips) {
    const bounds = tripDateBounds(trip.flights, trip.cruises);
    const derived = deriveTripStatus({ ...bounds, now });
    if (derived != null && derived !== trip.status) {
      await prisma.trip.update({ where: { id: trip.id }, data: { status: derived } });
      tripFlips++;
    }
  }

  const flights = staleFlights.count + futureFlown.count;
  const cruises = cruiseToInProgress.count + cruiseToFlown.count + cruiseToScheduled.count;
  const lodging =
    lodgingToInProgress.count + lodgingToCompleted.count + lodgingToScheduled.count;
  if (flights + cruises + lodging + tripFlips > 0) {
    logger.info({
      operation: "status_sweep_done",
      context: { flights, cruises, lodging, trips: tripFlips },
    });
  }
  return { flights, cruises, lodging, trips: tripFlips };
}
