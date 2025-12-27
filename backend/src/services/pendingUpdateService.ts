/**
 * Pending Update Service
 * 
 * Manages pending flight updates, including applying, rejecting, and editing them.
 * Also calculates statistics impact of updates.
 */

import { PrismaClient, PendingFlightUpdate, Flight } from '@prisma/client';
import { prisma } from '../db';
import logger from '../utils/logger';
import { calculateDistance } from '../utils/geo';
import { getCachedAirports } from './airportCache';

const prismaClient = prisma as PrismaClient;

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
) {
  const where: any = {
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
): Promise<PendingFlightUpdate | null> {
  return await prismaClient.pendingFlightUpdate.findFirst({
    where: {
      id,
      userId,
    },
    include: {
      flight: true,
    },
  });
}

/**
 * Calculate statistics impact of an update
 */
export async function calculateStatisticsImpact(
  flight: Flight,
  originalData: any,
  proposedData: any
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

  return {
    distance: {
      before: beforeStats.totalDistance,
      after: afterStats.totalDistance,
      change: afterStats.totalDistance - beforeStats.totalDistance,
    },
    flightTime: {
      before: beforeStats.totalFlightTime,
      after: afterStats.totalFlightTime,
      change: afterStats.totalFlightTime - beforeStats.totalFlightTime,
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
  flightData: any
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

    // Flight time (in minutes)
    const flightTime =
      (f.arrivalTime.getTime() - f.departureTime.getTime()) / (1000 * 60);
    totalFlightTime += flightTime;

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
  editedData?: any
): Promise<StatisticsImpact | null> {
  const pendingUpdate = await getPendingUpdateById(pendingUpdateId, userId);
  if (!pendingUpdate || !pendingUpdate.flight) {
    return null;
  }

  const flight = pendingUpdate.flight as any;
  const dataToUse = editedData || pendingUpdate.proposedData;

  // Get airport coordinates if needed
  const airportCodes = new Set<string>();
  if (dataToUse.depIata) airportCodes.add(dataToUse.depIata);
  if (dataToUse.depIcao) airportCodes.add(dataToUse.depIcao);
  if (dataToUse.arrIata) airportCodes.add(dataToUse.arrIata);
  if (dataToUse.arrIcao) airportCodes.add(dataToUse.arrIcao);

  const airports = await getCachedAirports(Array.from(airportCodes));

  // Build flight data with coordinates
  const flightData = {
    ...dataToUse,
    depLat: airports.get(dataToUse.depIata || dataToUse.depIcao || '')?.lat || flight.depLat,
    depLon: airports.get(dataToUse.depIata || dataToUse.depIcao || '')?.lon || flight.depLon,
    arrLat: airports.get(dataToUse.arrIata || dataToUse.arrIcao || '')?.lat || flight.arrLat,
    arrLon: airports.get(dataToUse.arrIata || dataToUse.arrIcao || '')?.lon || flight.arrLon,
  };

  return await calculateStatisticsImpact(
    flight,
    pendingUpdate.originalData,
    flightData
  );
}

/**
 * Update a pending update with edited data
 */
export async function updatePendingUpdate(
  id: string,
  userId: string,
  editedData: any
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
      pendingUpdate.originalData,
      editedData
    );

    // Recalculate statistics impact
    const flight = pendingUpdate.flight as any;
    const statisticsImpact = await previewStatisticsImpact(id, userId, editedData);

    const updated = await prismaClient.pendingFlightUpdate.update({
      where: { id },
      data: {
        editedData: editedData as any,
        editedChanges: editedChanges as any,
        statisticsImpact: statisticsImpact as any,
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
function calculateChanges(original: any, proposed: any): any[] {
  const changes: any[] = [];
  const fields = Object.keys({ ...original, ...proposed });

  for (const field of fields) {
    const oldValue = original[field];
    const newValue = proposed[field];

    if (oldValue !== newValue) {
      changes.push({
        field,
        oldValue,
        newValue,
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

    const flight = pendingUpdate.flight as any;
    const dataToApply = pendingUpdate.editedData || pendingUpdate.proposedData;

    // Get airport coordinates if airports changed
    let depLat = flight.depLat;
    let depLon = flight.depLon;
    let arrLat = flight.arrLat;
    let arrLon = flight.arrLon;

    if (dataToApply.depIata || dataToApply.depIcao) {
      const airportCodes = new Set<string>();
      if (dataToApply.depIata) airportCodes.add(dataToApply.depIata);
      if (dataToApply.depIcao) airportCodes.add(dataToApply.depIcao);
      if (dataToApply.arrIata) airportCodes.add(dataToApply.arrIata);
      if (dataToApply.arrIcao) airportCodes.add(dataToApply.arrIcao);

      const airports = await getCachedAirports(Array.from(airportCodes));
      const depAirport = airports.get(dataToApply.depIata || dataToApply.depIcao || '');
      const arrAirport = airports.get(dataToApply.arrIata || dataToApply.arrIcao || '');

      if (depAirport) {
        depLat = depAirport.lat;
        depLon = depAirport.lon;
      }
      if (arrAirport) {
        arrLat = arrAirport.lat;
        arrLon = arrAirport.lon;
      }
    }

    // Update flight
    const updatedFlight = await prismaClient.flight.update({
      where: { id: flight.id },
      data: {
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
        departureTime: dataToApply.departureTime
          ? new Date(dataToApply.departureTime)
          : flight.departureTime,
        arrivalTime: dataToApply.arrivalTime
          ? new Date(dataToApply.arrivalTime)
          : flight.arrivalTime,
        // Don't change status automatically
      },
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

    const updateData: any = {
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
          ...updateData,
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

    const expired = await prismaClient.pendingFlightUpdate.findMany({
      where: {
        status: 'pending',
        expiresAt: { lt: now },
      },
    });

    for (const update of expired) {
      await prismaClient.pendingFlightUpdate.update({
        where: { id: update.id },
        data: {
          status: 'expired',
          updatedAt: new Date(),
        },
      });

      await updateUserStatistics(update.userId, 'expired');
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

