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
import { getApiKey } from './apiKeyResolver';
import type { FlightDataSnapshot } from './pendingUpdateService';

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
    'status',
    'actualRoute',
    'overflownCountries',
    'routeDistance',
  ];

  for (const field of fieldsToCompare) {
    const oldValue = (original as Record<string, FlightFieldValue>)[field];
    const newValue = (proposed as Record<string, FlightFieldValue>)[field];

    if (oldValue === undefined && newValue !== undefined) {
      changes.push({
        field,
        oldValue: null,
        newValue,
        type: 'added',
      });
    } else if (oldValue !== undefined && newValue === undefined) {
      changes.push({
        field,
        oldValue,
        newValue: null,
        type: 'removed',
      });
    } else if (oldValue !== newValue && newValue !== undefined) {
      // Special handling for time fields
      if (field === 'departureTime' || field === 'arrivalTime') {
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
 * Check if changes are significant enough to create a pending update
 */
function hasSignificantChanges(changes: FlightChange[]): boolean {
  if (changes.length === 0) return false;

  // Prioritize critical changes (times, airports)
  const criticalFields = ['departureTime', 'arrivalTime', 'depIata', 'depIcao', 'arrIata', 'arrIcao'];
  const hasCriticalChanges = changes.some(c => criticalFields.includes(c.field));

  // If there are critical changes, always create update
  if (hasCriticalChanges) return true;

  // For optional changes (gate, terminal), require at least 2 changes
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
      return 0; // Auto-update disabled for this user
    }

    // Find active flights for this user
    const now = new Date();

    const activeFlights = await prismaClient.flight.findMany({
      where: {
        userId,
        flightNumber: { not: null },
        status: { in: ['scheduled', 'flown'] },
        departureTime: { lte: now },
        arrivalTime: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, // Only check flights from last 24h
      },
    });

    let updatesCreated = 0;

    for (const flight of activeFlights) {
      // Check if flight is active
      if (!isFlightActive(flight)) {
        continue;
      }

      // Check if only during flight is enabled
      if (userSettings.autoUpdateOnlyDuringFlight) {
        const flightEnd = flight.arrivalTime ? new Date(flight.arrivalTime) : null;
        if (flightEnd && now > flightEnd) {
          continue; // Flight already ended
        }
      }

      try {
        // Lookup flight data from API
        const dateStr = flight.departureTime ? flight.departureTime.toISOString().split('T')[0] : null;
        if (!dateStr) continue; // Cannot look up flights without a departure time
        const apiData = await lookupFlightDetails(flight.flightNumber!, dateStr, flight.userId);

        if (!apiData) {
          continue; // No data from API
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
          status: flight.status,
        };

        const changes = calculateChanges(originalSnapshot, proposedData);

        // Only create update if there are significant changes
        if (!hasSignificantChanges(changes)) {
          continue;
        }

        // Determine API source (check user key first, then global, then ENV)
        const aviationstackKey = await getApiKey('aviationstack', flight.userId);
        const airlabsKey = await getApiKey('airlabs', flight.userId);
        const apiSource = aviationstackKey
          ? 'aviationstack'
          : airlabsKey
          ? 'airlabs'
          : 'unknown';

        // Create pending update
        const updateId = await createPendingUpdate(
          flight,
          proposedData,
          changes,
          apiSource
        );

        if (updateId) {
          updatesCreated++;
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
