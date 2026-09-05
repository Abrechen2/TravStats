/**
 * Pending Update Service
 *
 * Manages pending flight updates, including applying, rejecting, and editing them.
 * Also calculates statistics impact of updates.
 */

import { PrismaClient, PendingFlightUpdate, Flight, Prisma } from '@prisma/client';
import { prisma } from '../db';
import logger from '../utils/logger';
import { calculateDistance } from '../utils/geo';
import { flightDurationOf } from '../shared/flightDuration';
import { getCachedAirports } from './airportCache';

const prismaClient = prisma as PrismaClient;

/**
 * API sources whose data comes from a live provider: their times are true
 * UTC and applying them counts as live tracking. Kept in sync with
 * `FlightLookupSource` in flightLookup.ts.
 */
const LIVE_API_SOURCES = ['aviationstack', 'airlabs', 'aerodatabox', 'opensky'];

/** Flight data fields used for original/proposed data snapshots */
export interface FlightDataSnapshot {
  airline?: string | null;
  aircraft?: string | null;
  gate?: string | null;
  terminal?: string | null;
  depIata?: string | null;
  depIcao?: string | null;
  depName?: string | null;
  arrIata?: string | null;
  arrIcao?: string | null;
  arrName?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  /** Actual off-block time (UTC ISO); populated when an API reports it */
  actualDeparture?: string | null;
  /** Actual on-block time (UTC ISO); populated when an API reports it */
  actualArrival?: string | null;
  status?: string | null;
  actualRoute?: unknown;
  overflownCountries?: string[] | null;
  routeDistance?: number | null;
}

/** Flight data snapshot extended with coordinate info */
interface FlightDataWithCoords extends FlightDataSnapshot {
  depLat?: number | null;
  depLon?: number | null;
  arrLat?: number | null;
  arrLon?: number | null;
}

/** A single change entry between original and proposed data */
export interface ChangeEntry {
  field: string;
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
  type: 'added' | 'removed' | 'changed';
}

/** Metadata for pending updates (e.g. historical enrichment) */
interface PendingUpdateMetadata {
  isHistoricalEnrichment?: boolean;
  confidence?: number;
  sourceFlightsCount?: number;
  [key: string]: unknown;
}

/** Enrichment history entry stored on Flight */
interface EnrichmentHistoryEntry {
  type: string;
  timestamp: string;
  confidence?: number;
  source?: string;
  sourceFlightsCount?: number;
}

export interface StatisticsImpact {
  distance: {
    before: number;
    after: number;
    change: number;
  };
  flightTime: {
    before: number; // minutes
    after: number; // minutes
    change: number; // minutes
  };
  airlines: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
  airports: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
}

/**
 * Get all pending updates for a user
 */
export async function getPendingUpdates(
  userId: string,
  filters?: {
    status?: string;
    flightId?: string;
  }
): Promise<PendingFlightUpdate[]> {
  const where: Prisma.PendingFlightUpdateWhereInput = {
    userId,
  };

  if (filters?.status) {
    where.status = filters.status;
  }

  if (filters?.flightId) {
    where.flightId = filters.flightId;
  }

  return await prismaClient.pendingFlightUpdate.findMany({
    where,
    include: {
      flight: {
        select: {
          id: true,
          flightNumber: true,
          airline: true,
          departureTime: true,
          arrivalTime: true,
          depIata: true,
          arrIata: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

/**
 * Get a single pending update by ID
 */
export async function getPendingUpdateById(
  id: string,
  userId: string
): Promise<(PendingFlightUpdate & { flight: Flight | null }) | null> {
  return await prismaClient.pendingFlightUpdate.findFirst({
    where: {
      id,
      userId,
    },
    include: {
      flight: true,
    },
  }) as (PendingFlightUpdate & { flight: Flight | null }) | null;
}

/**
 * Calculate statistics impact of an update
 */
export async function calculateStatisticsImpact(
  flight: Flight,
  originalData: FlightDataSnapshot,
  proposedData: FlightDataSnapshot
): Promise<StatisticsImpact> {
  // Get all user's flown flights for comparison
  const allFlights = await prismaClient.flight.findMany({
    where: {
      userId: flight.userId,
      status: 'flown',
    },
  });

  // Get airport coordinates for original and proposed data
  const originalAirportCodes = new Set<string>();
  if (originalData.depIata) originalAirportCodes.add(originalData.depIata);
  if (originalData.depIcao) originalAirportCodes.add(originalData.depIcao);
  if (originalData.arrIata) originalAirportCodes.add(originalData.arrIata);
  if (originalData.arrIcao) originalAirportCodes.add(originalData.arrIcao);

  const proposedAirportCodes = new Set<string>();
  if (proposedData.depIata) proposedAirportCodes.add(proposedData.depIata);
  if (proposedData.depIcao) proposedAirportCodes.add(proposedData.depIcao);
  if (proposedData.arrIata) proposedAirportCodes.add(proposedData.arrIata);
  if (proposedData.arrIcao) proposedAirportCodes.add(proposedData.arrIcao);

  const allCodes = Array.from(new Set([...originalAirportCodes, ...proposedAirportCodes]));
  const airports = await getCachedAirports(allCodes);

  // Build original data with coordinates
  const originalWithCoords = {
    ...originalData,
    depLat: airports.get(originalData.depIata || originalData.depIcao || '')?.lat || flight.depLat,
    depLon: airports.get(originalData.depIata || originalData.depIcao || '')?.lon || flight.depLon,
    arrLat: airports.get(originalData.arrIata || originalData.arrIcao || '')?.lat || flight.arrLat,
    arrLon: airports.get(originalData.arrIata || originalData.arrIcao || '')?.lon || flight.arrLon,
  };

  // Build proposed data with coordinates
  const proposedWithCoords = {
    ...proposedData,
    depLat: airports.get(proposedData.depIata || proposedData.depIcao || '')?.lat || flight.depLat,
    depLon: airports.get(proposedData.depIata || proposedData.depIcao || '')?.lon || flight.depLon,
    arrLat: airports.get(proposedData.arrIata || proposedData.arrIcao || '')?.lat || flight.arrLat,
    arrLon: airports.get(proposedData.arrIata || proposedData.arrIcao || '')?.lon || flight.arrLon,
  };

  // Calculate before stats
  const beforeStats = await calculateUserStats(allFlights, flight, originalWithCoords);

  // Calculate after stats (with proposed data)
  const afterStats = await calculateUserStats(allFlights, flight, proposedWithCoords);

  // Calculate flight time for this specific flight only
  const originalDepTime = originalData.departureTime ? new Date(originalData.departureTime) : flight.departureTime;
  const originalArrTime = originalData.arrivalTime ? new Date(originalData.arrivalTime) : flight.arrivalTime;
  const proposedDepTime = proposedData.departureTime ? new Date(proposedData.departureTime) : flight.departureTime;
  const proposedArrTime = proposedData.arrivalTime ? new Date(proposedData.arrivalTime) : flight.arrivalTime;

  const originalFlightTime = (originalArrTime && originalDepTime)
    ? Math.round((originalArrTime.getTime() - originalDepTime.getTime()) / (1000 * 60))
    : 0;
  const proposedFlightTime = (proposedArrTime && proposedDepTime)
    ? Math.round((proposedArrTime.getTime() - proposedDepTime.getTime()) / (1000 * 60))
    : 0;

  return {
    distance: {
      before: beforeStats.totalDistance,
      after: afterStats.totalDistance,
      change: afterStats.totalDistance - beforeStats.totalDistance,
    },
    flightTime: {
      before: originalFlightTime,
      after: proposedFlightTime,
      change: proposedFlightTime - originalFlightTime,
    },
    airlines: {
      before: beforeStats.airlines,
      after: afterStats.airlines,
      added: Array.from(afterStats.airlines).filter(
        a => !beforeStats.airlines.has(a)
      ),
      removed: Array.from(beforeStats.airlines).filter(
        a => !afterStats.airlines.has(a)
      ),
    },
    airports: {
      before: beforeStats.airports,
      after: afterStats.airports,
      added: Array.from(afterStats.airports).filter(
        a => !beforeStats.airports.has(a)
      ),
      removed: Array.from(beforeStats.airports).filter(
        a => !afterStats.airports.has(a)
      ),
    },
  };
}

/**
 * Calculate user stats with a specific flight data
 */
async function calculateUserStats(
  allFlights: Flight[],
  targetFlight: Flight,
  flightData: FlightDataWithCoords
): Promise<{
  totalDistance: number;
  totalFlightTime: number;
  airlines: Set<string>;
  airports: Set<string>;
}> {
  // Replace target flight with provided data
  const modifiedFlights = allFlights.map(f => {
    if (f.id === targetFlight.id) {
      return {
        ...f,
        depLat: flightData.depLat ?? f.depLat,
        depLon: flightData.depLon ?? f.depLon,
        arrLat: flightData.arrLat ?? f.arrLat,
        arrLon: flightData.arrLon ?? f.arrLon,
        depIata: flightData.depIata ?? f.depIata,
        depIcao: flightData.depIcao ?? f.depIcao,
        arrIata: flightData.arrIata ?? f.arrIata,
        arrIcao: flightData.arrIcao ?? f.arrIcao,
        airline: flightData.airline ?? f.airline,
        departureTime: flightData.departureTime
          ? new Date(flightData.departureTime)
          : f.departureTime,
        arrivalTime: flightData.arrivalTime
          ? new Date(flightData.arrivalTime)
          : f.arrivalTime,
      };
    }
    return f;
  });

  let totalDistance = 0;
  let totalFlightTime = 0;
  const airlines = new Set<string>();
  const airports = new Set<string>();

  for (const f of modifiedFlights) {
    // Distance
    if (f.depLat && f.depLon && f.arrLat && f.arrLon) {
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      totalDistance += dist;
    }

    // Flight time through the shared rule (forgejo#76) — the same number the
    // stats pages report for the row, never a placeholder-clock difference.
    totalFlightTime += flightDurationOf(f)?.minutes ?? 0;

    // Airlines
    if (f.airline) {
      airlines.add(f.airline);
    }

    // Airports
    if (f.depIata) airports.add(f.depIata);
    if (f.depIcao) airports.add(f.depIcao);
    if (f.arrIata) airports.add(f.arrIata);
    if (f.arrIcao) airports.add(f.arrIcao);
  }

  return {
    totalDistance: Math.round(totalDistance),
    totalFlightTime: Math.round(totalFlightTime),
    airlines,
    airports,
  };
}

/**
 * Preview statistics impact without saving
 */
export async function previewStatisticsImpact(
  pendingUpdateId: string,
  userId: string,
  editedData?: FlightDataSnapshot
): Promise<StatisticsImpact | null> {
  const pendingUpdate = await getPendingUpdateById(pendingUpdateId, userId);
  if (!pendingUpdate || !pendingUpdate.flight) {
    return null;
  }

  const flight = pendingUpdate.flight;
  const dataToUse = (editedData || pendingUpdate.proposedData) as FlightDataSnapshot | null;

  if (!dataToUse) {
    return null;
  }

  // Get airport coordinates if needed
  const airportCodes = new Set<string>();
  if (dataToUse.depIata) airportCodes.add(String(dataToUse.depIata));
  if (dataToUse.depIcao) airportCodes.add(String(dataToUse.depIcao));
  if (dataToUse.arrIata) airportCodes.add(String(dataToUse.arrIata));
  if (dataToUse.arrIcao) airportCodes.add(String(dataToUse.arrIcao));

  const airports = await getCachedAirports(Array.from(airportCodes));

  // Build flight data with coordinates
  const flightData = {
    ...dataToUse,
    depLat: airports.get(String(dataToUse.depIata || dataToUse.depIcao || ''))?.lat || flight.depLat,
    depLon: airports.get(String(dataToUse.depIata || dataToUse.depIcao || ''))?.lon || flight.depLon,
    arrLat: airports.get(String(dataToUse.arrIata || dataToUse.arrIcao || ''))?.lat || flight.arrLat,
    arrLon: airports.get(String(dataToUse.arrIata || dataToUse.arrIcao || ''))?.lon || flight.arrLon,
  };

  return await calculateStatisticsImpact(
    flight,
    pendingUpdate.originalData as FlightDataSnapshot,
    flightData
  );
}

/**
 * Update a pending update with edited data
 */
export async function updatePendingUpdate(
  id: string,
  userId: string,
  editedData: FlightDataSnapshot
): Promise<PendingFlightUpdate | null> {
  try {
    const pendingUpdate = await getPendingUpdateById(id, userId);
    if (!pendingUpdate) {
      throw new Error('Pending update not found');
    }

    if (pendingUpdate.status !== 'pending') {
      throw new Error('Can only edit pending updates');
    }

    // Calculate edited changes
    const editedChanges = calculateChanges(
      pendingUpdate.originalData as FlightDataSnapshot,
      editedData
    );

    // Recalculate statistics impact
    if (!pendingUpdate.flight) {
      throw new Error('Flight not found for pending update');
    }
    const statisticsImpact = await previewStatisticsImpact(id, userId, editedData);

    const updated = await prismaClient.pendingFlightUpdate.update({
      where: { id },
      data: {
        editedData: editedData as Prisma.InputJsonValue,
        editedChanges: editedChanges as unknown as Prisma.InputJsonValue,
        statisticsImpact: statisticsImpact as unknown as Prisma.InputJsonValue,
        editedAt: new Date(),
        status: 'edited',
        updatedAt: new Date(),
      },
    });

    logger.info({
      operation: 'update_pending_update',
      message: 'Updated pending flight update',
      context: {
        pendingUpdateId: id,
        userId,
      },
    });

    return updated;
  } catch (error) {
    logger.error({
      operation: 'update_pending_update_error',
      message: 'Failed to update pending update',
      context: { id, userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Calculate changes between two data objects
 */
function calculateChanges(original: FlightDataSnapshot, proposed: FlightDataSnapshot): ChangeEntry[] {
  const changes: ChangeEntry[] = [];
  const allKeys = new Set([...Object.keys(original), ...Object.keys(proposed)]);

  for (const field of allKeys) {
    const oldValue = (original as Record<string, unknown>)[field];
    const newValue = (proposed as Record<string, unknown>)[field];

    if (oldValue !== newValue) {
      changes.push({
        field,
        oldValue: oldValue as ChangeEntry['oldValue'],
        newValue: newValue as ChangeEntry['newValue'],
        type:
          oldValue === undefined
            ? 'added'
            : newValue === undefined
            ? 'removed'
            : 'changed',
      });
    }
  }

  return changes;
}

/**
 * Apply a pending update to the flight
 */
export async function applyPendingUpdate(
  id: string,
  userId: string
): Promise<Flight | null> {
  try {
    const pendingUpdate = await getPendingUpdateById(id, userId);
    if (!pendingUpdate || !pendingUpdate.flight) {
      throw new Error('Pending update not found');
    }

    if (pendingUpdate.status !== 'pending' && pendingUpdate.status !== 'edited') {
      throw new Error('Can only apply pending or edited updates');
    }

    if (!pendingUpdate.flight) {
      throw new Error('Flight not found for pending update');
    }

    const flight = pendingUpdate.flight;
    const dataToApply = (pendingUpdate.editedData || pendingUpdate.proposedData) as FlightDataSnapshot | null;

    if (!dataToApply) {
      throw new Error('No data to apply');
    }

    // Get airport coordinates if airports changed
    let depLat = flight.depLat;
    let depLon = flight.depLon;
    let arrLat = flight.arrLat;
    let arrLon = flight.arrLon;

    if (dataToApply.depIata || dataToApply.depIcao) {
      const airportCodes = new Set<string>();
      if (dataToApply.depIata) airportCodes.add(String(dataToApply.depIata));
      if (dataToApply.depIcao) airportCodes.add(String(dataToApply.depIcao));
      if (dataToApply.arrIata) airportCodes.add(String(dataToApply.arrIata));
      if (dataToApply.arrIcao) airportCodes.add(String(dataToApply.arrIcao));

      const airports = await getCachedAirports(Array.from(airportCodes));
      const depAirport = airports.get(String(dataToApply.depIata || dataToApply.depIcao || ''));
      const arrAirport = airports.get(String(dataToApply.arrIata || dataToApply.arrIcao || ''));

      if (depAirport) {
        depLat = depAirport.lat;
        depLon = depAirport.lon;
      }
      if (arrAirport) {
        arrLat = arrAirport.lat;
        arrLon = arrAirport.lon;
      }
    }

    // Check if this is a historical enrichment
    const metadata = pendingUpdate.metadata as PendingUpdateMetadata | null;
    const isHistoricalEnrichment = metadata?.isHistoricalEnrichment === true;

    // Prepare update data
    const nextActualDeparture = dataToApply.actualDeparture
      ? new Date(String(dataToApply.actualDeparture))
      : flight.actualDeparture;
    const nextActualArrival = dataToApply.actualArrival
      ? new Date(String(dataToApply.actualArrival))
      : flight.actualArrival;

    const nextDepartureTime = dataToApply.departureTime
      ? new Date(String(dataToApply.departureTime))
      : flight.departureTime;
    const nextArrivalTime = dataToApply.arrivalTime
      ? new Date(String(dataToApply.arrivalTime))
      : flight.arrivalTime;

    const updateData: Prisma.FlightUpdateInput = {
      airline: dataToApply.airline ?? flight.airline,
      aircraft: dataToApply.aircraft ?? flight.aircraft,
      gate: dataToApply.gate ?? flight.gate,
      terminal: dataToApply.terminal ?? flight.terminal,
      depIata: dataToApply.depIata ?? flight.depIata,
      depIcao: dataToApply.depIcao ?? flight.depIcao,
      depName: dataToApply.depName ?? flight.depName,
      depLat,
      depLon,
      arrIata: dataToApply.arrIata ?? flight.arrIata,
      arrIcao: dataToApply.arrIcao ?? flight.arrIcao,
      arrName: dataToApply.arrName ?? flight.arrName,
      arrLat,
      arrLon,
      departureTime: nextDepartureTime,
      arrivalTime: nextArrivalTime,
      actualDeparture: nextActualDeparture,
      actualArrival: nextActualArrival,
      // Keep delayMinutes in sync with actual vs. scheduled departure so the
      // UI shows the correct delay without a manual edit.
      delayMinutes:
        nextActualDeparture && nextDepartureTime
          ? Math.round(
              (nextActualDeparture.getTime() - nextDepartureTime.getTime()) / 60000
            )
          : flight.delayMinutes,
      // Don't change status automatically
    };

    // Update route data if present
    if (dataToApply.actualRoute !== undefined) {
      updateData.actualRoute = dataToApply.actualRoute as Prisma.InputJsonValue;
    }
    if (dataToApply.overflownCountries !== undefined) {
      updateData.overflownCountries = dataToApply.overflownCountries ?? undefined;
    }
    if (dataToApply.routeDistance !== undefined) {
      updateData.routeDistance = dataToApply.routeDistance;
    }
    if (isHistoricalEnrichment) {
      updateData.routeSource = 'historical_aggregation';
    } else if (LIVE_API_SOURCES.includes(pendingUpdate.apiSource)) {
      updateData.routeSource = 'live_tracking';
      updateData.hasLiveTracking = true;
      // Live APIs report true UTC. When the stored row still carries legacy
      // semantics (LEGACY_FAKE_UTC / DATE_ONLY / UNKNOWN), applying a real-UTC
      // value without upgrading the flag would make the display layer
      // re-interpret the corrected timestamp via the airport timezone —
      // shifting every shown time by the airport's UTC offset.
      if (dataToApply.departureTime && flight.depTimeSemantics !== 'UTC') {
        updateData.depTimeSemantics = 'UTC';
      }
      if (dataToApply.arrivalTime && flight.arrTimeSemantics !== 'UTC') {
        updateData.arrTimeSemantics = 'UTC';
      }
    }

    // Set data source and last modified by
    if (isHistoricalEnrichment) {
      // Preserve original data source if it exists, otherwise set to historical_enrichment
      if (!flight.dataSource) {
        updateData.dataSource = 'historical_enrichment';
      }
      updateData.lastModifiedBy = 'historical_enrichment';
    } else {
      // For live updates
      if (pendingUpdate.apiSource && pendingUpdate.apiSource !== 'historical_aggregation') {
        updateData.dataSource = 'live_update';
        updateData.lastModifiedBy = 'auto_update';
      }
    }

    // Update enrichment history
    if (isHistoricalEnrichment && metadata) {
      const existingHistory = (Array.isArray(flight.enrichmentHistory) ? flight.enrichmentHistory : []) as unknown as EnrichmentHistoryEntry[];
      const newHistoryEntry: EnrichmentHistoryEntry = {
        type: 'historical_enrichment',
        timestamp: new Date().toISOString(),
        confidence: metadata.confidence,
        source: 'aggregated_from_live_flights',
        sourceFlightsCount: metadata.sourceFlightsCount,
      };
      updateData.enrichmentHistory = [...existingHistory, newHistoryEntry] as unknown as Prisma.InputJsonValue;
    }

    // Update flight
    const updatedFlight = await prismaClient.flight.update({
      where: { id: flight.id },
      data: updateData,
    });

    // Mark pending update as applied
    await prismaClient.pendingFlightUpdate.update({
      where: { id },
      data: {
        status: 'applied',
        appliedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Update user statistics
    await updateUserStatistics(userId, 'applied');

    logger.info({
      operation: 'apply_pending_update',
      message: 'Applied pending flight update',
      context: {
        pendingUpdateId: id,
        flightId: flight.id,
        userId,
      },
    });

    return updatedFlight;
  } catch (error) {
    logger.error({
      operation: 'apply_pending_update_error',
      message: 'Failed to apply pending update',
      context: { id, userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Reject a pending update
 */
export async function rejectPendingUpdate(
  id: string,
  userId: string
): Promise<boolean> {
  try {
    const pendingUpdate = await getPendingUpdateById(id, userId);
    if (!pendingUpdate) {
      throw new Error('Pending update not found');
    }

    if (pendingUpdate.status !== 'pending' && pendingUpdate.status !== 'edited') {
      throw new Error('Can only reject pending or edited updates');
    }

    await prismaClient.pendingFlightUpdate.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Update user statistics
    await updateUserStatistics(userId, 'rejected');

    logger.info({
      operation: 'reject_pending_update',
      message: 'Rejected pending flight update',
      context: {
        pendingUpdateId: id,
        userId,
      },
    });

    return true;
  } catch (error) {
    logger.error({
      operation: 'reject_pending_update_error',
      message: 'Failed to reject pending update',
      context: { id, userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return false;
  }
}

/**
 * Update user statistics for pending updates
 */
export async function updateUserStatistics(
  userId: string,
  action: 'applied' | 'rejected' | 'edited' | 'expired'
): Promise<void> {
  try {
    const stats = await prismaClient.pendingUpdateStatistics.findUnique({
      where: { userId },
    });

    const updateData: Prisma.PendingUpdateStatisticsUpdateInput = {
      lastUpdated: new Date(),
    };

    if (action === 'applied') {
      updateData.appliedUpdates = { increment: 1 };
    } else if (action === 'rejected') {
      updateData.rejectedUpdates = { increment: 1 };
    } else if (action === 'edited') {
      updateData.editedUpdates = { increment: 1 };
    } else if (action === 'expired') {
      updateData.expiredUpdates = { increment: 1 };
    }

    updateData.totalUpdates = { increment: 1 };

    if (stats) {
      await prismaClient.pendingUpdateStatistics.update({
        where: { userId },
        data: updateData,
      });
    } else {
      await prismaClient.pendingUpdateStatistics.create({
        data: {
          userId,
          totalUpdates: 1,
          appliedUpdates: action === 'applied' ? 1 : 0,
          rejectedUpdates: action === 'rejected' ? 1 : 0,
          editedUpdates: action === 'edited' ? 1 : 0,
          expiredUpdates: action === 'expired' ? 1 : 0,
          mostChangedFields: {},
          lastUpdated: new Date(),
        },
      });
    }
  } catch (error) {
    logger.error({
      operation: 'update_user_statistics_error',
      message: 'Failed to update user statistics',
      context: { userId, action },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

/**
 * Cleanup expired pending updates
 */
export async function cleanupExpiredUpdates(): Promise<number> {
  try {
    const now = new Date();

    // Get expired updates (only need userId for statistics)
    const expired = await prismaClient.pendingFlightUpdate.findMany({
      where: {
        status: 'pending',
        expiresAt: { lt: now },
      },
      select: { id: true, userId: true },
    });

    if (expired.length > 0) {
      // Batch update all expired statuses at once (instead of N individual updates)
      await prismaClient.pendingFlightUpdate.updateMany({
        where: {
          id: { in: expired.map((u) => u.id) },
        },
        data: {
          status: 'expired',
          updatedAt: new Date(),
        },
      });

      // Update user statistics (grouped by userId to minimize DB calls)
      const userIds = [...new Set(expired.map((u) => u.userId))];
      for (const userId of userIds) {
        const count = expired.filter((u) => u.userId === userId).length;
        for (let i = 0; i < count; i++) {
          await updateUserStatistics(userId, 'expired');
        }
      }
    }

    logger.info({
      operation: 'cleanup_expired_updates',
      message: 'Cleaned up expired pending updates',
      context: {
        count: expired.length,
      },
    });

    return expired.length;
  } catch (error) {
    logger.error({
      operation: 'cleanup_expired_updates_error',
      message: 'Failed to cleanup expired updates',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return 0;
  }
}
