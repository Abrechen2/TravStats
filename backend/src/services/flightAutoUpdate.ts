/**
 * Flight Auto-Update Service
 *
 * Automatically fetches current flight data from APIs during active flights
 * and creates pending updates for user review.
 */

import { PrismaClient, Flight } from "../prisma";
import { lookupFlightDetails, FlightLookupResult } from "./flightLookup";
import { LookupOutcomeLog } from "./flightLookup/providerOutcome";
import { prisma } from "../db";
import logger from "../utils/logger";
import { DEMO_USERNAME } from "../utils/sharedDemo";
import { recalculateNextApiCheckAt, slotAfterProviderFailure } from "../utils/smartCheckSchedule";
import { applyPendingUpdate } from "./pendingUpdateService";
import { announceChange } from "./notifications/announceFlightChange";
import type { FlightDataSnapshot } from "./pendingUpdateService";
import { sweepStatuses } from "./statusSweep";
import { runFinalArrivalSweep } from "./finalArrivalLookup";
import {
  getAirportTimezone,
  normalizeFlightTimeUtc,
  toLocalDateString,
  type FlightTimeSemantics,
} from "../utils/timezone";
import { markFlownOnReportedLanding } from "./flightLandedStatus";
import { wasAlreadyRejected, type FlightChange } from "./flightUpdateRejections";

const prismaClient = prisma as PrismaClient;

import {
  calculateChanges,
  convertApiDataToProposed,
  createPendingUpdate,
  hasSignificantChanges,
} from "./flightAutoUpdate/changes";

export {
  isFlightActive,
  calculateChanges,
  hasSignificantChanges,
  convertApiDataToProposed,
  createPendingUpdate,
  type PendingUpdateData,
} from "./flightAutoUpdate/changes";

export type { FlightChange, FlightFieldValue } from "./flightUpdateRejections";

// Beyond this, the API is describing a different rotation of a (usually
// daily) flight number, not a schedule change to OUR flight. Legitimate
// same-rotation shifts are minutes to a few hours; the wrong day is ±24h.
const ROTATION_MISMATCH_MAX_HOURS = 12;

type UserSettingsRow = NonNullable<
  Awaited<ReturnType<typeof prismaClient.userSettings.findUnique>>
>;

/**
 * The date filter MUST be the LOCAL departure day at the departure
 * airport, not the UTC day of the stored instant — flight-data APIs
 * key rotations by local date. EK415 SYD→DXB departs 11 Aug 06:00
 * local = 10 Aug 20:00 UTC; querying "2026-08-10" returned the
 * previous day's rotation, which auto-apply then wrote over the
 * flight, shifting it a full day into the past (prod, 2026-08-11).
 * Every early-morning departure east of Greenwich hits this.
 */
async function localDepartureDay(flight: Flight): Promise<{
  realDeparture: Date | null;
  dateStr: string | null;
}> {
  const depTz = await getAirportTimezone(flight.depIata ?? flight.depIcao);
  const realDeparture =
    normalizeFlightTimeUtc(
      flight.departureTime,
      flight.depTimeSemantics as FlightTimeSemantics,
      depTz
    ) ?? flight.departureTime;
  const dateStr = realDeparture ? toLocalDateString(realDeparture, depTz) : null;
  return { realDeparture, dateStr };
}

/**
 * Always recalculate nextApiCheckAt after a check attempt.
 * The tracking flags come from the response we JUST received, falling
 * back to the stored row: the API knows the aircraft is airborne before
 * that fact is ever written to the database (proposed changes land in a
 * PendingUpdate, not on the flight). Scheduling off the stale row alone
 * is what ended polling before delayed flights had landed.
 */
async function scheduleNextCheck(
  flight: Flight,
  apiData: FlightLookupResult | null,
  outcomes: LookupOutcomeLog
): Promise<void> {
  const observedDeparture = apiData?.actualDeparture ?? flight.actualDeparture;
  const observedArrival = apiData?.actualArrival ?? flight.actualArrival;
  const recalculated = recalculateNextApiCheckAt(
    flight.departureTime,
    flight.arrivalTime,
    flight.status,
    flight.flightNumber,
    {
      hasActualDeparture: Boolean(observedDeparture),
      hasActualArrival: Boolean(observedArrival),
    }
  );
  // A provider that FAILED has not said "no data": retry soon (forgejo#365).
  const providerFailed = !apiData && outcomes.failures().length > 0;
  const nextCheck = providerFailed
    ? slotAfterProviderFailure(recalculated, flight.arrivalTime, flight.departureTime)
    : recalculated;
  await prismaClient.flight.update({
    where: { id: flight.id },
    data: { nextApiCheckAt: nextCheck },
  });
  logger.info(
    {
      flightId: flight.id,
      nextCheck: nextCheck?.toISOString(),
      providerFailed,
      operation: "next_check_scheduled",
    },
    "Next API check scheduled"
  );
}

/**
 * Rotation guard: daily flight numbers make a ±24h mismatch the
 * signature failure mode of any date confusion. A schedule CHANGE is
 * minutes-to-a-few-hours; a different ROTATION is a day apart. If the
 * API's scheduled departure is further than 12h from ours, we are
 * looking at the wrong day's aircraft — proposing (or auto-applying)
 * its times would rewrite the user's flight onto the wrong date.
 */
function isWrongRotation(
  flight: Flight,
  apiData: FlightLookupResult,
  realDeparture: Date | null
): boolean {
  if (!apiData.departureTime || !realDeparture) return false;
  const diffHours =
    Math.abs(new Date(apiData.departureTime).getTime() - realDeparture.getTime()) / 3_600_000;
  if (diffHours <= ROTATION_MISMATCH_MAX_HOURS) return false;
  const operation = "rotation_mismatch_rejected";
  const diff = Math.round(diffHours * 10) / 10;
  logger.warn(
    { flightId: flight.id, diffHours: diff, operation },
    "Rejected API data: scheduled departure too far from ours — wrong rotation"
  );
  logger.debug({
    flightId: flight.id,
    operation,
    storedDeparture: realDeparture.toISOString(),
    apiDeparture: new Date(apiData.departureTime).toISOString(),
  });
  return true;
}

/**
 * Mark this flight as live-tracked the moment an API actually returns data,
 * regardless of whether the diff is "significant" enough for a PendingUpdate.
 * This is the seed signal that lets Historical Enrichment later find
 * reference flights — keeping it coupled to the significance filter was
 * a bootstrap deadlock (fresh accounts could never seed live-tracking).
 */
async function markLiveTracked(flight: Flight): Promise<void> {
  if (flight.hasLiveTracking) return;
  await prismaClient.flight.update({
    where: { id: flight.id },
    data: { hasLiveTracking: true },
  });
  logger.info(
    { flightId: flight.id, operation: "has_live_tracking_set" },
    "Marked flight as live-tracked (first successful API response)"
  );
}

/** The stored side of the diff, in the snapshot shape `calculateChanges` reads. */
function snapshotOf(flight: Flight): FlightDataSnapshot {
  return {
    airline: flight.airline,
    aircraft: flight.aircraft,
    gate: flight.gate,
    terminal: flight.terminal,
    depIata: flight.depIata,
    depIcao: flight.depIcao,
    arrIata: flight.arrIata,
    arrIcao: flight.arrIcao,
    departureTime: flight.departureTime?.toISOString() ?? null,
    arrivalTime: flight.arrivalTime?.toISOString() ?? null,
    actualDeparture: flight.actualDeparture?.toISOString() ?? null,
    actualArrival: flight.actualArrival?.toISOString() ?? null,
    status: flight.status,
  };
}

/**
 * If the user has disabled approval gating, apply the update immediately
 * instead of leaving it to rot in pending_flight_updates forever.
 * The pending row is still created for audit (status: applied).
 */
async function applyOrAnnounce(
  userId: string,
  flight: Flight,
  updateId: string,
  changes: FlightChange[],
  notifyOpts: { diverted: boolean; cancelled: boolean },
  userSettings: UserSettingsRow
): Promise<void> {
  if (userSettings.autoUpdateRequireApproval !== false) {
    announceChange(userId, flight, changes, { ...notifyOpts, pending: true });
    return;
  }
  const applied = await applyPendingUpdate(updateId, userId);
  if (applied) {
    announceChange(userId, flight, changes, { ...notifyOpts, pending: false });
    logger.info(
      { flightId: flight.id, pendingUpdateId: updateId, operation: "auto_applied" },
      "Auto-applied update (requireApproval=false)"
    );
  } else {
    logger.warn(
      { flightId: flight.id, pendingUpdateId: updateId, operation: "auto_apply_failed" },
      "Auto-apply failed — pending update left in place"
    );
    announceChange(userId, flight, changes, { ...notifyOpts, pending: true });
  }
}

/**
 * Diff the provider's answer against the flight and, when something
 * significant changed, create the pending update (and apply or announce it).
 * Returns whether an update row was created.
 */
async function proposeChanges(
  flight: Flight,
  apiData: FlightLookupResult,
  userId: string,
  userSettings: UserSettingsRow
): Promise<{ created: boolean; significant: boolean }> {
  const proposedData = convertApiDataToProposed(apiData, flight);
  const changes = calculateChanges(snapshotOf(flight), proposedData);

  // Only create update if there are significant changes
  if (!hasSignificantChanges(changes)) {
    logger.info(
      { flightId: flight.id, operation: "no_significant_changes" },
      "No significant changes"
    );
    return { created: false, significant: false };
  }

  // The user already rejected this exact proposal — do not re-offer it.
  if (await wasAlreadyRejected(flight.id, changes)) return { created: false, significant: false };

  const changedFieldNames = changes.map((c) => c.field);
  logger.info(
    {
      flightId: flight.id,
      changeCount: changes.length,
      changedFields: changedFieldNames,
      operation: "significant_changes_found",
    },
    `Found ${changes.length} change(s): ${changedFieldNames.join(", ")}`
  );

  // Attribute the update to the provider that actually served the data.
  // (Guessing from which keys are configured mislabelled every AirLabs
  // fallback result as "aviationstack" — prod audit 2026-06-07.)
  const apiSource = apiData.source ?? "unknown";
  const updateId = await createPendingUpdate(flight, proposedData, changes, apiSource);
  if (!updateId) return { created: false, significant: true };

  const notifyOpts = {
    diverted: apiData.statusOverride === "diverted",
    cancelled: proposedData.status === "cancelled",
  };
  await applyOrAnnounce(userId, flight, updateId, changes, notifyOpts, userSettings);
  return { created: true, significant: true };
}

/**
 * One due flight. `null` means the flight was passed over before any
 * proposal was weighed (no time, no data, wrong rotation, no significant
 * change) — the caller then skips the inter-call pause; otherwise it says
 * whether an update row was created.
 */
async function checkOneFlight(
  flight: Flight,
  userId: string,
  userSettings: UserSettingsRow
): Promise<number | null> {
  const { realDeparture, dateStr } = await localDepartureDay(flight);
  if (!dateStr) {
    logger.info(
      { flightId: flight.id, operation: "skip_no_departure_time" },
      "Skipping flight — no departure time"
    );
    await prismaClient.flight.update({
      where: { id: flight.id },
      data: { nextApiCheckAt: null },
    });
    return null;
  }

  logger.info({ flightId: flight.id, operation: "api_lookup_start" }, "Looking up flight");
  // Pass full departure/arrival times so lookupFlightDetails can gate
  // Aviationstack to the live window (±3h of departure / in-flight).
  const outcomes = new LookupOutcomeLog();
  const apiData = await lookupFlightDetails(
    flight.flightNumber!,
    dateStr,
    flight.userId,
    flight.departureTime,
    flight.arrivalTime,
    // Two legs on one day (FRA-MUC-JFK) share a number: name the leg.
    flight.depIata ?? flight.depIcao ?? undefined,
    outcomes
  );
  await scheduleNextCheck(flight, apiData, outcomes);

  if (!apiData) {
    logger.info({ flightId: flight.id, operation: "api_no_data" }, "No API data returned");
    return null;
  }
  if (isWrongRotation(flight, apiData, realDeparture)) return null;
  await markLiveTracked(flight);

  // A reported touchdown ends "scheduled" now (flightLandedStatus.ts).
  await markFlownOnReportedLanding(flight, apiData.actualArrival);

  const { created, significant } = await proposeChanges(flight, apiData, userId, userSettings);
  if (!significant) return null;
  return created ? 1 : 0;
}

/**
 * Check and update flights for a specific user
 */
export async function checkAndUpdateFlightsForUser(userId: string): Promise<number> {
  try {
    // Get user settings
    const userSettings = await prismaClient.userSettings.findUnique({
      where: { userId },
    });

    if (!userSettings?.autoUpdateEnabled) {
      logger.info(
        { userId, operation: "check_flights_skipped", reason: "auto_update_disabled" },
        "Skipping flight checks — auto-update disabled for user"
      );
      return 0;
    }

    // Find flights whose next API check is due
    const now = new Date();

    const activeFlights = await prismaClient.flight.findMany({
      where: {
        userId,
        flightNumber: { not: null },
        status: "scheduled",
        nextApiCheckAt: { lte: now },
      },
    });

    logger.info(
      {
        userId,
        operation: "check_flights_due",
        count: activeFlights.length,
        flightIds: activeFlights.map((f) => f.id),
      },
      `Found ${activeFlights.length} flight(s) due for API check`
    );

    let updatesCreated = 0;

    for (const flight of activeFlights) {
      try {
        const created = await checkOneFlight(flight, userId, userSettings);
        if (created === null) continue;
        updatesCreated += created;

        // Rate limiting: wait a bit between API calls
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        logger.warn({
          operation: "check_flight_update_error",
          message: "Failed to check flight update",
          context: { flightId: flight.id, userId },
          error: {
            message: error instanceof Error ? error.message : "Unknown error",
          },
        });
        // Continue with next flight
      }
    }

    return updatesCreated;
  } catch (error) {
    logger.error({
      operation: "check_and_update_flights_error",
      message: "Failed to check and update flights for user",
      context: { userId },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return 0;
  }
}

/**
 * Every account the auto-update sweep may run for.
 *
 * Its own function so the exclusion below has one home and a test can read it
 * without running the sweep. The SHARED demo account is left out (independent
 * review, 2026-09-17, finding A4): this job spends the instance's provider
 * quota, unattended, and the demo login is published on a public instance, so
 * one visitor switching the setting on would bill the operator for lookups
 * over 160 seeded sample flights. `isDemo` alone is the wrong question — the
 * preview's `admin`/`alex`/`claude` and the local dev admin carry the flag and
 * own their accounts, so only `isDemo AND username = 'demo'` drops out, the
 * same predicate as `isSharedDemoAccount`.
 */
export async function findAutoUpdateEligibleUserIds(): Promise<string[]> {
  const rows = await prismaClient.userSettings.findMany({
    where: {
      autoUpdateEnabled: true,
      user: { NOT: { isDemo: true, username: DEMO_USERNAME } },
    },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

/**
 * Check and update flights for all users with auto-update enabled
 */
export async function checkAndUpdateAllFlights(): Promise<number> {
  try {
    // Converge stored statuses with the dates before the API sweep — reduces
    // wasted API calls on flights/cruises that already departed but are stuck
    // in "scheduled" (replaces the retired transitionZombieFlights /
    // transitionPastCruises one-way flips; see services/statusSweep.ts).
    await sweepStatuses(undefined, "open");

    /**
     * The flights that sweep just flipped to `flown` WITHOUT an actual arrival
     * get their one last question here, through the provider that can answer
     * for a past date (services/finalArrivalLookup.ts).
     *
     * Right after the sweep on purpose: the sweep is what marks them, and the
     * mark is `nextApiCheckAt` left standing on a `flown` row. Running every
     * five minutes costs nothing extra — a flight is marked once and cleared
     * on its single attempt, so the volume is the number of flights the user
     * actually took, not the size of their logbook.
     *
     * Failure here must not stop the ordinary check below: this is a
     * best-effort backfill for legs that would otherwise never be asked about
     * again, not a precondition for anything.
     */
    try {
      const finalArrivals = await runFinalArrivalSweep();
      if (finalArrivals.attempted > 0) {
        logger.info(
          { ...finalArrivals, operation: "final_arrival_sweep_complete" },
          `Last-attempt lookups: ${finalArrivals.attempted} attempted, ${finalArrivals.filled} filled`
        );
      }
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          operation: "final_arrival_sweep_failed",
        },
        "Final-arrival sweep failed; continuing with the scheduled checks"
      );
    }

    const users = await findAutoUpdateEligibleUserIds();

    let totalUpdates = 0;

    for (const userId of users) {
      const updates = await checkAndUpdateFlightsForUser(userId);
      totalUpdates += updates;
    }

    logger.info({
      operation: "check_all_flights_complete",
      message: "Completed checking all flights for updates",
      context: {
        usersChecked: users.length,
        totalUpdatesCreated: totalUpdates,
      },
    });

    return totalUpdates;
  } catch (error) {
    logger.error({
      operation: "check_all_flights_error",
      message: "Failed to check all flights",
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return 0;
  }
}
