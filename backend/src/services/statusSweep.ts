import { prisma } from "../db";
import logger from "../utils/logger";
import {
  FLIGHT_ARRIVAL_SLACK_HOURS,
  FLIGHT_DEPARTURE_SLACK_HOURS,
  CRUISE_SLACK_HOURS,
  deriveTripStatus,
  tripStatusBounds,
} from "../shared/statusDerivation";
import { dayAnchorNow, now as clockNow } from "../shared/time/clock";
import { profileZoneFromSettings } from "../shared/time/profileZone";

const H = 60 * 60 * 1000;

/** Which users a day-column sweep covers: listed ones, or everyone not listed. */
type UserScope = { userId: { in: string[] } } | { userId: { notIn: string[] } };

/**
 * Users grouped by the zone that answers "today" for them (ADR 0002 D4): one
 * group per profile zone, and one UTC group for everyone else — accounts with
 * no usable zone, which `profileZoneOf` also answers in UTC.
 */
/**
 * Every user's profile zone. A user without one is absent and reads "today"
 * in UTC — the documented default (`profileZone.ts`), never a place's zone.
 */
async function profileZonesByUser(): Promise<Map<string, string>> {
  const rows = await prisma.userSettings.findMany({ select: { userId: true, data: true } });
  return new Map(rows.map((row) => [row.userId, profileZoneFromSettings(row.data).zone]));
}

async function profileZoneScopes(): Promise<Array<{ zone: string; scope: UserScope }>> {
  const rows = await prisma.userSettings.findMany({ select: { userId: true, data: true } });
  const byZone = new Map<string, string[]>();
  for (const row of rows) {
    const { zone, source } = profileZoneFromSettings(row.data);
    if (source !== "profile" || zone === "UTC") continue;
    byZone.set(zone, [...(byZone.get(zone) ?? []), row.userId]);
  }
  const listed = [...byZone.values()].flat();
  return [
    ...[...byZone.entries()].map(([zone, ids]) => ({ zone, scope: { userId: { in: ids } } })),
    { zone: "UTC", scope: { userId: { notIn: listed } } },
  ];
}

/**
 * Cruises and stays are dated by DAY columns (UTC-midnight anchors), so their
 * "has it begun / is it over" is asked against the user's profile-zone wall
 * clock (`dayAnchorNow`), not the Greenwich instant: a stay in a Kiritimati
 * account completes when check-out day begins there, fourteen hours before
 * it begins in UTC.
 */
async function sweepDayStatuses(
  anchor: Date,
  scope: UserScope
): Promise<{ cruises: number; lodging: number }> {
  const cruiseCutoff = new Date(anchor.getTime() - CRUISE_SLACK_HOURS * H);

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
  // Cruises: three-way from start/end (+slack)
  const cruiseToInProgress = await prisma.cruise.updateMany({
    where: {
      ...scope,
      status: { in: ["scheduled", "flown"] },
      startDate: { not: null, lte: anchor },
      endDate: { not: null, gte: cruiseCutoff },
    },
    data: { status: "in_progress" },
  });
  const cruiseToFlown = await prisma.cruise.updateMany({
    where: {
      ...scope,
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
      ...scope,
      status: { in: ["flown", "in_progress"] },
      startDate: { gt: anchor },
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
      ...scope,
      status: { in: ["scheduled", "completed"] },
      checkIn: { lte: anchor },
      checkOut: { gt: anchor },
    },
    data: { status: "in_progress" },
  });
  const lodgingToCompleted = await prisma.lodgingStay.updateMany({
    where: {
      ...scope,
      status: { in: ["scheduled", "in_progress"] },
      checkOut: { lte: anchor },
    },
    data: { status: "completed" },
  });
  const lodgingToScheduled = await prisma.lodgingStay.updateMany({
    where: {
      ...scope,
      status: { in: ["in_progress", "completed"] },
      checkIn: { gt: anchor },
    },
    data: { status: "scheduled" },
  });

  return {
    cruises: cruiseToInProgress.count + cruiseToFlown.count + cruiseToScheduled.count,
    lodging: lodgingToInProgress.count + lodgingToCompleted.count + lodgingToScheduled.count,
  };
}

export async function sweepStatuses(now: Date = clockNow()): Promise<{
  flights: number;
  cruises: number;
  lodging: number;
  rail: number;
  trips: number;
}> {
  const arrivalCutoff = new Date(now.getTime() - FLIGHT_ARRIVAL_SLACK_HOURS * H);
  const departureCutoff = new Date(now.getTime() - FLIGHT_DEPARTURE_SLACK_HOURS * H);

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

  // Cruises and stays: day columns, asked per profile zone (ADR 0002 D4).
  let cruises = 0;
  let lodging = 0;
  for (const { zone, scope } of await profileZoneScopes()) {
    const counts = await sweepDayStatuses(dayAnchorNow(zone, now), scope);
    cruises += counts.cruises;
    lodging += counts.lodging;
  }

  // Rail journeys: the lodging split over two instants (`deriveRailStatus`).
  // No slack for the same reason as lodging — no legacy writer ever set this
  // column. An unknown arrival reads as the departure, as the deriver does.
  const railToInProgress = await prisma.railJourney.updateMany({
    where: {
      status: { in: ["scheduled", "completed"] },
      departureTime: { lte: now },
      arrivalTime: { gt: now },
    },
    data: { status: "in_progress" },
  });
  const railToCompleted = await prisma.railJourney.updateMany({
    where: {
      status: { in: ["scheduled", "in_progress"] },
      OR: [{ arrivalTime: { lte: now } }, { arrivalTime: null, departureTime: { lte: now } }],
    },
    data: { status: "completed" },
  });
  const railToScheduled = await prisma.railJourney.updateMany({
    where: { status: { in: ["in_progress", "completed"] }, departureTime: { gt: now } },
    data: { status: "scheduled" },
  });

  // Trips: recompute from segment date bounds, update diffs only. A trip's
  // days begin in its owner's profile zone (ADR 0002 D4, `tripStatusBounds`).
  const zoneOfUser = await profileZonesByUser();
  const trips = await prisma.trip.findMany({
    select: {
      id: true,
      userId: true,
      status: true,
      startDate: true,
      endDate: true,
      flights: { select: { departureTime: true, arrivalTime: true } },
      cruises: { select: { startDate: true, endDate: true } },
      lodgingStays: { select: { checkIn: true, checkOut: true } },
      routes: {
        where: { kind: "roadtrip" },
        select: { stops: { select: { startDate: true, endDate: true } } },
      },
      railJourneys: { select: { departureTime: true, arrivalTime: true } },
    },
  });
  let tripFlips = 0;
  for (const trip of trips) {
    // Same rule as the edit path and the explicit recompute — see
    // `tripStatusBounds`. The sweep loaded flights and cruises only, so a
    // hotel-only or hand-dated trip was invisible to it (AUD-024).
    const bounds = tripStatusBounds({
      flights: trip.flights,
      cruises: trip.cruises,
      lodgingStays: trip.lodgingStays,
      roadtrips: trip.routes,
      railJourneys: trip.railJourneys,
      ownStartDate: trip.startDate,
      ownEndDate: trip.endDate,
      zone: zoneOfUser.get(trip.userId) ?? "UTC",
    });
    const derived = deriveTripStatus({ ...bounds, now });
    if (derived != null && derived !== trip.status) {
      await prisma.trip.update({ where: { id: trip.id }, data: { status: derived } });
      tripFlips++;
    }
  }

  const flights = staleFlights.count + futureFlown.count;
  const rail = railToInProgress.count + railToCompleted.count + railToScheduled.count;
  if (flights + cruises + lodging + rail + tripFlips > 0) {
    logger.info({
      operation: "status_sweep_done",
      context: { flights, cruises, lodging, rail, trips: tripFlips },
    });
  }
  return { flights, cruises, lodging, rail, trips: tripFlips };
}
