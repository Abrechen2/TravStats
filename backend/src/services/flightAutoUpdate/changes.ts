/**
 * Flight auto-update: what changed (diff of stored vs. provider data) and the
 * pending-update row that carries it. Split out of flightAutoUpdate.ts, which
 * re-exports everything here, so the sweep itself stays readable.
 */

import { PrismaClient, Flight, Prisma } from "../../prisma";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import type { FlightLookupResult } from "../flightLookup";
import type { FlightDataSnapshot } from "../pendingUpdateService";
import { DEVICE_SOURCES, isDeviceSource } from "../flightDevice/deviceSource";
import { pendingUpdateExpiryMs } from "../autoUpdateExpiry";
import type { FlightChange, FlightFieldValue } from "../flightUpdateRejections";

const prismaClient = prisma as PrismaClient;

export interface PendingUpdateData {
  originalData: FlightDataSnapshot;
  proposedData: FlightDataSnapshot;
  changes: FlightChange[];
  apiSource: string;
}

const TIME_CHANGE_THRESHOLD_MINUTES = 5; // Only create update if time difference > 5 minutes
const FLIGHT_ACTIVE_BUFFER_HOURS = 2; // Consider flight active for 2 hours after arrival

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
    (flight.status === "scheduled" || flight.status === "flown")
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
    "airline",
    "flightNumber",
    "aircraft",
    "gate",
    "terminal",
    "depIata",
    "depIcao",
    "arrIata",
    "arrIcao",
    "departureTime",
    "arrivalTime",
    "actualDeparture",
    "actualArrival",
    "status",
    "actualRoute",
    "overflownCountries",
    "routeDistance",
  ];

  // Treat null, undefined and empty string uniformly as "empty" so that a first-ever
  // fill from Prisma's "" default is classified as `added`, not `changed`.
  const isEmpty = (v: FlightFieldValue): boolean => v === null || v === undefined || v === "";

  for (const field of fieldsToCompare) {
    const oldValue = (original as Record<string, FlightFieldValue>)[field];
    const newValue = (proposed as Record<string, FlightFieldValue>)[field];

    if (isEmpty(oldValue) && !isEmpty(newValue)) {
      changes.push({
        field,
        oldValue: null,
        newValue,
        type: "added",
      });
    } else if (!isEmpty(oldValue) && isEmpty(newValue)) {
      changes.push({
        field,
        oldValue,
        newValue: null,
        type: "removed",
      });
    } else if (oldValue !== newValue && !isEmpty(newValue)) {
      // Special handling for time fields — includes actual off/on-block times
      // so single-minute-level jitter doesn't churn a "changed" event on every
      // API poll.
      const timeFields = new Set([
        "departureTime",
        "arrivalTime",
        "actualDeparture",
        "actualArrival",
      ]);
      if (timeFields.has(field)) {
        const oldTime =
          oldValue && (typeof oldValue === "string" || typeof oldValue === "number")
            ? new Date(oldValue).getTime()
            : 0;
        const newTime =
          newValue && (typeof newValue === "string" || typeof newValue === "number")
            ? new Date(newValue).getTime()
            : 0;
        const diffMinutes = Math.abs(newTime - oldTime) / (1000 * 60);

        // Only include if difference is significant
        if (diffMinutes > TIME_CHANGE_THRESHOLD_MINUTES) {
          changes.push({
            field,
            oldValue,
            newValue,
            type: "changed",
          });
        }
      } else {
        changes.push({
          field,
          oldValue,
          newValue,
          type: "changed",
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
    "departureTime",
    "arrivalTime",
    "actualDeparture",
    "actualArrival",
    "depIata",
    "depIcao",
    "arrIata",
    "arrIcao",
    // TravStats#156: a new gate or terminal is the one thing a passenger at
    // the airport needs to hear, and it used to need a second change before
    // it counted. Provider flapping is bounded by the push dedupe: each new
    // value reaches a phone at most once.
    "gate",
    "terminal",
    // Only a cancellation ever reaches here (convertApiDataToProposed).
    "status",
  ];
  if (changes.some((c) => criticalFields.includes(c.field))) return true;

  // Initial fill — single change is enough to be worth showing the user
  if (changes.some((c) => c.type === "added")) return true;

  // Pure modifications to existing values need multiple to count
  return changes.length >= 2;
}

/**
 * Convert API flight data to proposed flight data format
 *
 * Note: apiData.departureTime and apiData.arrivalTime should already be in UTC
 * (converted by lookupFlightDetails from local airport time to UTC)
 */
export function convertApiDataToProposed(
  apiData: FlightLookupResult,
  originalFlight: Flight
): FlightDataSnapshot {
  const proposed: FlightDataSnapshot = {
    /**
     * FILLED, never replaced — the one field on this list where the stored
     * value outranks the provider's, and the operand order says so.
     *
     * On a codeshare the two are not "old" and "new", they are two true
     * answers to different questions: the MARKETING carrier sells the seat,
     * the OPERATING carrier flies the aeroplane. A provider may report either.
     * Measured on a real account on 2026-09-03: LX1104, Zurich to Munich,
     * operated by Helvetic — stored as "Helvetic Airways", and rewritten to
     * "United Airlines" by an auto-applied update. The row then contradicted
     * itself, because `airlineIata`/`airlineIcao` still read 2L/OAW, which is
     * Helvetic. Nobody was asked, and nothing said it had happened.
     *
     * The identity of the carrier lives in those two CODES; this column is the
     * display name beside them, and the user's own text is the better source
     * for it. The same swap also ends a quieter nuisance: "SWISS" against
     * "Swiss" produced a change, a proposal and an inbox entry for a
     * difference of capitalisation.
     *
     * An empty column is still filled from the provider — that is a gap, not a
     * disagreement, and filling it takes nothing away.
     */
    airline: originalFlight.airline || apiData.airline,
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
    // A provider's cancellation is proposed like any other change
    // (TravStats#156). Nothing else may change the status from here: a
    // diversion keeps "scheduled" (its new destination is the arrIata change),
    // and "flown"/"historical" belong to the status sweep.
    status: apiData.statusOverride === "cancelled" ? "cancelled" : originalFlight.status,
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
  apiSource: string,
  metadata?: Prisma.InputJsonValue
): Promise<string | null> {
  try {
    // One open suggestion per flight AND per kind of witness. A phone's own
    // observation (forgejo#194) and a provider's report are kept apart: folded
    // into one row, the later writer replaced the other's proposal and its
    // attribution, so a provider poll would erase what the phone saw.
    // The user's window, but never before the flight has ended (forgejo#389).
    const flightEndMs =
      (flight.arrivalTime ? flight.arrivalTime.getTime() : Date.now()) +
      FLIGHT_ACTIVE_BUFFER_HOURS * 60 * 60 * 1000;
    const expiresAt = new Date(
      Math.max(Date.now() + (await pendingUpdateExpiryMs(flight.userId)), flightEndMs)
    );
    const existing = await prismaClient.pendingFlightUpdate.findFirst({
      where: {
        flightId: flight.id,
        status: "pending",
        apiSource: isDeviceSource(apiSource) ? apiSource : { notIn: [...DEVICE_SOURCES] },
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
          ...(metadata === undefined ? {} : { metadata }),
          fetchedAt: new Date(),
          expiresAt,
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

    // Calculate statistics impact
    let statisticsImpact: Prisma.InputJsonValue | null = null;
    try {
      const { calculateStatisticsImpact } = await import("../pendingUpdateService");
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
        operation: "calculate_statistics_impact_error",
        message: "Failed to calculate statistics impact",
        context: { flightId: flight.id },
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }

    const pendingUpdate = await prismaClient.pendingFlightUpdate.create({
      data: {
        flightId: flight.id,
        userId: flight.userId,
        status: "pending",
        originalData: originalData as unknown as Prisma.InputJsonValue,
        proposedData: proposedData as unknown as Prisma.InputJsonValue,
        changes: changes as unknown as Prisma.InputJsonValue,
        apiSource,
        fetchedAt: new Date(),
        expiresAt,
        statisticsImpact: statisticsImpact as Prisma.InputJsonValue,
        ...(metadata === undefined ? {} : { metadata }),
      },
    });

    logger.info({
      operation: "create_pending_update",
      message: "Created pending flight update",
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
      operation: "create_pending_update_error",
      message: "Failed to create pending update",
      context: { flightId: flight.id, userId: flight.userId },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}
