/**
 * Flight Auto-Update Service
 *
 * Automatically fetches current flight data from APIs during active flights
 * and creates pending updates for user review.
 */

import { PrismaClient, Flight, Prisma } from '@prisma/client';
import { lookupFlightDetails, FlightLookupResult } from './flightLookup';
import { prisma } from '../db';
import logger from '../utils/logger';
import { recalculateNextApiCheckAt } from '../utils/smartCheckSchedule';
import { applyPendingUpdate } from './pendingUpdateService';
import type { FlightDataSnapshot } from './pendingUpdateService';
import { sweepStatuses } from './statusSweep';
import {
  getAirportTimezone,
  normalizeFlightTimeUtc,
  toLocalDateString,
  type FlightTimeSemantics,
} from '../utils/timezone';

const prismaClient = prisma as PrismaClient;

/** Union type for values that can appear in flight data fields */
type FlightFieldValue = string | number | boolean | null | undefined | string[] | unknown[];

export interface FlightChange {
  field: string;
  oldValue: FlightFieldValue;
  newValue: FlightFieldValue;
  type: 'added' | 'removed' | 'changed';
}

export interface PendingUpdateData {
  originalData: FlightDataSnapshot;
  proposedData: FlightDataSnapshot;
  changes: FlightChange[];
  apiSource: string;
}

const TIME_CHANGE_THRESHOLD_MINUTES = 5; // Only create update if time difference > 5 minutes
const FLIGHT_ACTIVE_BUFFER_HOURS = 2; // Consider flight active for 2 hours after arrival
// Beyond this, the API is describing a different rotation of a (usually
// daily) flight number, not a schedule change to OUR flight. Legitimate
// same-rotation shifts are minutes to a few hours; the wrong day is ±24h.
const ROTATION_MISMATCH_MAX_HOURS = 12;

/**
 * Check if a flight is currently active (during flight time + buffer)
 */
export function isFlightActive(flight: Flight): boolean {
  // Historical flights have no times and are never "active"
  if (!flight.departureTime || !flight.arrivalTime) return false;
  const now = new Date();
  const departureTime = new Date(flight.departureTime);
  const arrivalTime = new Date(flight.arrivalTime);
  const bufferEnd = new Date(arrivalTime.getTime() + FLIGHT_ACTIVE_BUFFER_HOURS * 60 * 60 * 1000);

  // Flight is active if: departureTime <= now <= arrivalTime + buffer
  return (
    departureTime <= now &&
    now <= bufferEnd &&
    (flight.status === 'scheduled' || flight.status === 'flown')
  );
}

/**
 * Calculate differences between original and proposed flight data
 */
export function calculateChanges(
  original: FlightDataSnapshot,
  proposed: FlightDataSnapshot
): FlightChange[] {
  const changes: FlightChange[] = [];

  // Fields to compare
  const fieldsToCompare = [
    'airline',
    'flightNumber',
    'aircraft',
    'gate',
    'terminal',
    'depIata',
    'depIcao',
    'arrIata',
    'arrIcao',
    'departureTime',
    'arrivalTime',
    'actualDeparture',
    'actualArrival',
    'status',
    'actualRoute',
    'overflownCountries',
    'routeDistance',
  ];

  // Treat null, undefined and empty string uniformly as "empty" so that a first-ever
  // fill from Prisma's "" default is classified as `added`, not `changed`.
  const isEmpty = (v: FlightFieldValue): boolean =>
    v === null || v === undefined || v === '';

  for (const field of fieldsToCompare) {
    const oldValue = (original as Record<string, FlightFieldValue>)[field];
    const newValue = (proposed as Record<string, FlightFieldValue>)[field];

    if (isEmpty(oldValue) && !isEmpty(newValue)) {
      changes.push({
        field,
        oldValue: null,
        newValue,
        type: 'added',
      });
    } else if (!isEmpty(oldValue) && isEmpty(newValue)) {
      changes.push({
        field,
        oldValue,
        newValue: null,
        type: 'removed',
      });
    } else if (oldValue !== newValue && !isEmpty(newValue)) {
      // Special handling for time fields — includes actual off/on-block times
      // so single-minute-level jitter doesn't churn a "changed" event on every
      // API poll.
      const timeFields = new Set(['departureTime', 'arrivalTime', 'actualDeparture', 'actualArrival']);
      if (timeFields.has(field)) {
        const oldTime = oldValue && (typeof oldValue === 'string' || typeof oldValue === 'number') ? new Date(oldValue).getTime() : 0;
        const newTime = newValue && (typeof newValue === 'string' || typeof newValue === 'number') ? new Date(newValue).getTime() : 0;
        const diffMinutes = Math.abs(newTime - oldTime) / (1000 * 60);

        // Only include if difference is significant
        if (diffMinutes > TIME_CHANGE_THRESHOLD_MINUTES) {
          changes.push({
            field,
            oldValue,
            newValue,
            type: 'changed',
          });
        }
      } else {
        changes.push({
          field,
          oldValue,
          newValue,
          type: 'changed',
        });
      }
    }
  }

  return changes;
}

/**
 * Check if changes are significant enough to create a pending update.
 *
 * Rules:
 *  - Any change to a critical field (times, airports) is significant.
 *  - Filling a previously-empty field (type `added`) is significant — even a single
 *    one — because "first time we know the gate" is information the user should see.
 *  - Pure modifications to already-populated non-critical fields (gate A12 → B07)
 *    need ≥2 to avoid churn from API noise on a single field.
 *
 * Exported for unit testing.
 */
export function hasSignificantChanges(changes: FlightChange[]): boolean {
  if (changes.length === 0) return false;

  const criticalFields = [
    'departureTime',
    'arrivalTime',
    'actualDeparture',
    'actualArrival',
    'depIata',
    'depIcao',
    'arrIata',
    'arrIcao',
  ];
  if (changes.some(c => criticalFields.includes(c.field))) return true;

  // Initial fill — single change is enough to be worth showing the user
  if (changes.some(c => c.type === 'added')) return true;

  // Pure modifications to existing values need multiple to count
  return changes.length >= 2;
}

/**
 * Convert API flight data to proposed flight data format
 *
 * Note: apiData.departureTime and apiData.arrivalTime should already be in UTC
 * (converted by lookupFlightDetails from local airport time to UTC)
 */
function convertApiDataToProposed(
  apiData: FlightLookupResult,
  originalFlight: Flight
): FlightDataSnapshot {
  const proposed: FlightDataSnapshot = {
    airline: apiData.airline || originalFlight.airline,
    aircraft: apiData.aircraft || originalFlight.aircraft,
    gate: apiData.departure?.gate || originalFlight.gate,
    terminal: apiData.departure?.terminal || originalFlight.terminal,
    depIata: apiData.departure?.iata || originalFlight.depIata,
    depIcao: apiData.departure?.icao || originalFlight.depIcao,
    arrIata: apiData.arrival?.iata || originalFlight.arrIata,
    arrIcao: apiData.arrival?.icao || originalFlight.arrIcao,
    // Times are already in UTC from lookupFlightDetails, just ensure ISO format
    departureTime: apiData.departureTime
      ? new Date(apiData.departureTime).toISOString()
      : (originalFlight.departureTime?.toISOString() ?? null),
    arrivalTime: apiData.arrivalTime
      ? new Date(apiData.arrivalTime).toISOString()
      : (originalFlight.arrivalTime?.toISOString() ?? null),
    actualDeparture: apiData.actualDeparture
      ? new Date(apiData.actualDeparture).toISOString()
      : (originalFlight.actualDeparture?.toISOString() ?? null),
    actualArrival: apiData.actualArrival
      ? new Date(apiData.actualArrival).toISOString()
      : (originalFlight.actualArrival?.toISOString() ?? null),
    status: originalFlight.status, // Don't change status automatically
  };

  return proposed;
}

/**
 * Create a pending update for a flight
 */
export async function createPendingUpdate(
  flight: Flight,
  proposedData: FlightDataSnapshot,
  changes: FlightChange[],
  apiSource: string
): Promise<string | null> {
  try {
    // Check if there's already a pending update for this flight
    const existing = await prismaClient.pendingFlightUpdate.findFirst({
      where: {
        flightId: flight.id,
        status: 'pending',
      },
    });

    if (existing) {
      // Update existing pending update
      const updated = await prismaClient.pendingFlightUpdate.update({
        where: { id: existing.id },
        data: {
          proposedData: proposedData as unknown as Prisma.InputJsonValue,
          changes: changes as unknown as Prisma.InputJsonValue,
          apiSource,
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          updatedAt: new Date(),
        },
      });
      return updated.id;
    }

    // Create original data snapshot
    const originalData = {
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

    // Calculate expiry (24 hours from now or after flight ends, whichever is later)
    const flightEnd = flight.arrivalTime ? new Date(flight.arrivalTime) : new Date();
    flightEnd.setHours(flightEnd.getHours() + FLIGHT_ACTIVE_BUFFER_HOURS);
    const expiresAt = new Date(Math.max(Date.now() + 24 * 60 * 60 * 1000, flightEnd.getTime()));

    // Calculate statistics impact
    let statisticsImpact: Prisma.InputJsonValue | null = null;
    try {
      const { calculateStatisticsImpact } = await import('./pendingUpdateService');
      const impact = await calculateStatisticsImpact(flight, originalData, proposedData);
      if (impact) {
        statisticsImpact = {
          ...impact,
          airlines: {
            before: Array.from(impact.airlines.before),
            after: Array.from(impact.airlines.after),
            added: impact.airlines.added,
            removed: impact.airlines.removed,
          },
          airports: {
            before: Array.from(impact.airports.before),
            after: Array.from(impact.airports.after),
            added: impact.airports.added,
            removed: impact.airports.removed,
          },
        };
      }
    } catch (error: unknown) {
      logger.warn({
        operation: 'calculate_statistics_impact_error',
        message: 'Failed to calculate statistics impact',
        context: { flightId: flight.id },
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    const pendingUpdate = await prismaClient.pendingFlightUpdate.create({
      data: {
        flightId: flight.id,
        userId: flight.userId,
        status: 'pending',
        originalData: originalData as unknown as Prisma.InputJsonValue,
        proposedData: proposedData as unknown as Prisma.InputJsonValue,
        changes: changes as unknown as Prisma.InputJsonValue,
        apiSource,
        fetchedAt: new Date(),
        expiresAt,
        statisticsImpact: statisticsImpact as Prisma.InputJsonValue,
      },
    });

    logger.info({
      operation: 'create_pending_update',
      message: 'Created pending flight update',
      context: {
        pendingUpdateId: pendingUpdate.id,
        flightId: flight.id,
        userId: flight.userId,
        changeCount: changes.length,
        apiSource,
      },
    });

    return pendingUpdate.id;
  } catch (error) {
    logger.error({
      operation: 'create_pending_update_error',
      message: 'Failed to create pending update',
      context: { flightId: flight.id, userId: flight.userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
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
      logger.info({ userId, operation: 'check_flights_skipped', reason: 'auto_update_disabled' },
        'Skipping flight checks — auto-update disabled for user');
      return 0;
    }

    // Find flights whose next API check is due
    const now = new Date();

    const activeFlights = await prismaClient.flight.findMany({
      where: {
        userId,
        flightNumber: { not: null },
        status: 'scheduled',
        nextApiCheckAt: { lte: now },
      },
    });

    logger.info({ userId, operation: 'check_flights_due', count: activeFlights.length,
      flights: activeFlights.map(f => ({ id: f.id, fn: f.flightNumber, dep: f.depIata, arr: f.arrIata, depTime: f.departureTime?.toISOString() })),
    }, `Found ${activeFlights.length} flight(s) due for API check`);

    let updatesCreated = 0;

    for (const flight of activeFlights) {
      try {
        // Lookup flight data from API.
        //
        // The date filter MUST be the LOCAL departure day at the departure
        // airport, not the UTC day of the stored instant — flight-data APIs
        // key rotations by local date. EK415 SYD→DXB departs 11 Aug 06:00
        // local = 10 Aug 20:00 UTC; querying "2026-08-10" returned the
        // previous day's rotation, which auto-apply then wrote over the
        // flight, shifting it a full day into the past (prod, 2026-08-11).
        // Every early-morning departure east of Greenwich hits this.
        const depTz = await getAirportTimezone(flight.depIata ?? flight.depIcao);
        const realDeparture = normalizeFlightTimeUtc(
          flight.departureTime,
          flight.depTimeSemantics as FlightTimeSemantics,
          depTz,
        ) ?? flight.departureTime;
        const dateStr = realDeparture ? toLocalDateString(realDeparture, depTz) : null;
        if (!dateStr) {
          logger.info({ flightId: flight.id, flightNumber: flight.flightNumber, operation: 'skip_no_departure_time' },
            `Skipping ${flight.flightNumber} — no departure time`);
          await prismaClient.flight.update({
            where: { id: flight.id },
            data: { nextApiCheckAt: null },
          });
          continue;
        }

        logger.info({ flightId: flight.id, flightNumber: flight.flightNumber, date: dateStr, operation: 'api_lookup_start' },
          `Looking up ${flight.flightNumber} on ${dateStr}`);
        // Pass full departure/arrival times so lookupFlightDetails can gate
        // Aviationstack to the live window (±3h of departure / in-flight).
        const apiData = await lookupFlightDetails(
          flight.flightNumber!,
          dateStr,
          flight.userId,
          flight.departureTime,
          flight.arrivalTime,
        );

        // Always recalculate nextApiCheckAt after a check attempt.
        // The tracking flags come from the response we JUST received, falling
        // back to the stored row: the API knows the aircraft is airborne before
        // that fact is ever written to the database (proposed changes land in a
        // PendingUpdate, not on the flight). Scheduling off the stale row alone
        // is what ended polling before delayed flights had landed.
        const observedDeparture = apiData?.actualDeparture ?? flight.actualDeparture;
        const observedArrival = apiData?.actualArrival ?? flight.actualArrival;
        const nextCheck = recalculateNextApiCheckAt(
          flight.departureTime,
          flight.arrivalTime,
          flight.status,
          flight.flightNumber,
          {
            hasActualDeparture: Boolean(observedDeparture),
            hasActualArrival: Boolean(observedArrival),
          },
        );
        await prismaClient.flight.update({
          where: { id: flight.id },
          data: { nextApiCheckAt: nextCheck },
        });
        logger.info({ flightId: flight.id, flightNumber: flight.flightNumber, nextCheck: nextCheck?.toISOString(), operation: 'next_check_scheduled' },
          `Next check for ${flight.flightNumber}: ${nextCheck?.toISOString() ?? 'none'}`);

        if (!apiData) {
          logger.info({ flightId: flight.id, flightNumber: flight.flightNumber, date: dateStr, operation: 'api_no_data' },
            `No API data returned for ${flight.flightNumber} on ${dateStr}`);
          continue;
        }

        // Rotation guard: daily flight numbers make a ±24h mismatch the
        // signature failure mode of any date confusion. A schedule CHANGE is
        // minutes-to-a-few-hours; a different ROTATION is a day apart. If the
        // API's scheduled departure is further than 12h from ours, we are
        // looking at the wrong day's aircraft — proposing (or auto-applying)
        // its times would rewrite the user's flight onto the wrong date.
        if (apiData.departureTime && realDeparture) {
          const diffHours = Math.abs(
            new Date(apiData.departureTime).getTime() - realDeparture.getTime()
          ) / 3_600_000;
          if (diffHours > ROTATION_MISMATCH_MAX_HOURS) {
            logger.warn({
              flightId: flight.id,
              flightNumber: flight.flightNumber,
              storedDeparture: realDeparture.toISOString(),
              apiDeparture: new Date(apiData.departureTime).toISOString(),
              diffHours: Math.round(diffHours * 10) / 10,
              operation: 'rotation_mismatch_rejected',
            }, `Rejected API data for ${flight.flightNumber}: scheduled departure ${Math.round(diffHours)}h away from ours — wrong rotation`);
            continue;
          }
        }

        // Mark this flight as live-tracked the moment an API actually returns data,
        // regardless of whether the diff is "significant" enough for a PendingUpdate.
        // This is the seed signal that lets Historical Enrichment later find
        // reference flights — keeping it coupled to the significance filter was
        // a bootstrap deadlock (fresh accounts could never seed live-tracking).
        if (!flight.hasLiveTracking) {
          await prismaClient.flight.update({
            where: { id: flight.id },
            data: { hasLiveTracking: true },
          });
          logger.info({ flightId: flight.id, flightNumber: flight.flightNumber, operation: 'has_live_tracking_set' },
            `Marked ${flight.flightNumber} as live-tracked (first successful API response)`);
        }

        // Convert API data to proposed format
        const proposedData = convertApiDataToProposed(apiData, flight);

        // Calculate changes
        const originalSnapshot = {
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

        const changes = calculateChanges(originalSnapshot, proposedData);

        // Only create update if there are significant changes
        if (!hasSignificantChanges(changes)) {
          logger.info({ flightId: flight.id, flightNumber: flight.flightNumber, operation: 'no_significant_changes' },
            `No significant changes for ${flight.flightNumber}`);
          continue;
        }

        const changedFieldNames = changes.map(c => c.field);
        logger.info({ flightId: flight.id, flightNumber: flight.flightNumber, changeCount: changes.length,
          changedFields: changedFieldNames, operation: 'significant_changes_found' },
          `Found ${changes.length} change(s) for ${flight.flightNumber}: ${changedFieldNames.join(', ')}`);

        // Attribute the update to the provider that actually served the data.
        // (Guessing from which keys are configured mislabelled every AirLabs
        // fallback result as "aviationstack" — prod audit 2026-06-07.)
        const apiSource = apiData.source ?? 'unknown';

        // Create pending update
        const updateId = await createPendingUpdate(
          flight,
          proposedData,
          changes,
          apiSource
        );

        if (updateId) {
          updatesCreated++;

          // If user has disabled approval gating, apply the update immediately
          // instead of leaving it to rot in pending_flight_updates forever.
          // The pending row is still created for audit (status: applied).
          if (userSettings.autoUpdateRequireApproval === false) {
            const applied = await applyPendingUpdate(updateId, userId);
            if (applied) {
              logger.info({ flightId: flight.id, flightNumber: flight.flightNumber,
                pendingUpdateId: updateId, operation: 'auto_applied' },
                `Auto-applied update for ${flight.flightNumber} (requireApproval=false)`);
            } else {
              logger.warn({ flightId: flight.id, flightNumber: flight.flightNumber,
                pendingUpdateId: updateId, operation: 'auto_apply_failed' },
                `Auto-apply failed for ${flight.flightNumber} — pending update left in place`);
            }
          }
        }

        // Rate limiting: wait a bit between API calls
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.warn({
          operation: 'check_flight_update_error',
          message: 'Failed to check flight update',
          context: { flightId: flight.id, userId },
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        // Continue with next flight
      }
    }

    return updatesCreated;
  } catch (error) {
    logger.error({
      operation: 'check_and_update_flights_error',
      message: 'Failed to check and update flights for user',
      context: { userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return 0;
  }
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
    await sweepStatuses();

    // Get all users with auto-update enabled
    const users = await prismaClient.userSettings.findMany({
      where: {
        autoUpdateEnabled: true,
      },
      select: {
        userId: true,
      },
    });

    let totalUpdates = 0;

    for (const user of users) {
      const updates = await checkAndUpdateFlightsForUser(user.userId);
      totalUpdates += updates;
    }

    logger.info({
      operation: 'check_all_flights_complete',
      message: 'Completed checking all flights for updates',
      context: {
        usersChecked: users.length,
        totalUpdatesCreated: totalUpdates,
      },
    });

    return totalUpdates;
  } catch (error) {
    logger.error({
      operation: 'check_all_flights_error',
      message: 'Failed to check all flights',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return 0;
  }
}
