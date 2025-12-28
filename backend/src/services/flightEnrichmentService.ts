/**
 * Flight Enrichment Service
 * 
 * Handles historical flight data enrichment by aggregating data from
 * live-tracked flights with the same flight number.
 */

import { PrismaClient, Flight, UserSettings } from '@prisma/client';
import { prisma } from '../db';
import logger from '../utils/logger';

const prismaClient = prisma as PrismaClient;

export interface UserEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxAgeYears: number;
  autoProcess: boolean;
  maxPerDay: number;
  requireApproval: boolean;
}

export interface EnrichmentCandidate {
  flightId: string;
  flightNumber: string;
  missingFields: string[];
  missingRoute: boolean;
  ageYears: number;
  confidence: number;
}

export interface RouteAnomaly {
  type: 'route_change' | 'aircraft_change' | 'inconsistent_countries';
  severity: 'high' | 'medium' | 'low';
  description: string;
  affectedFlights: number;
}

export interface AggregatedFlightData {
  // Basis-Daten
  aircraft?: string;
  depIcao?: string;
  depIata?: string;
  arrIcao?: string;
  arrIata?: string;
  gate?: string;
  terminal?: string;
  
  // Route-Daten
  typicalRoute?: {
    waypoints: Array<{lat: number; lon: number}>;
    overflownCountries: string[];
    routeDistance: number;
  };
  
  // Metadaten
  sourceFlightsCount: number;
  confidence: number;
  anomalies: RouteAnomaly[];
  routeConsistency: 'high' | 'medium' | 'low';
}

/**
 * Get user enrichment settings
 */
export async function getUserEnrichmentSettings(userId: string): Promise<UserEnrichmentSettings | null> {
  try {
    const userSettings = await prismaClient.userSettings.findUnique({
      where: { userId },
    });

    if (!userSettings) {
      return null;
    }

    return {
      enabled: userSettings.historicalEnrichmentEnabled ?? false,
      minConfidence: userSettings.historicalEnrichmentMinConfidence ?? 60,
      maxAgeYears: userSettings.historicalEnrichmentMaxAgeYears ?? 5,
      autoProcess: userSettings.historicalEnrichmentAutoProcess ?? false,
      maxPerDay: userSettings.historicalEnrichmentMaxPerDay ?? 50,
      requireApproval: userSettings.historicalEnrichmentRequireApproval ?? true,
    };
  } catch (error) {
    logger.error({
      operation: 'get_user_enrichment_settings_error',
      message: 'Failed to get user enrichment settings',
      context: { userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Find flights that are candidates for historical enrichment
 */
export async function findEnrichmentCandidates(
  userId: string,
  settings?: UserEnrichmentSettings
): Promise<EnrichmentCandidate[]> {
  try {
    // Get settings if not provided
    const enrichmentSettings = settings || await getUserEnrichmentSettings(userId);
    
    if (!enrichmentSettings || !enrichmentSettings.enabled) {
      return [];
    }

    const now = new Date();
    const maxAgeDate = new Date();
    maxAgeDate.setFullYear(maxAgeDate.getFullYear() - enrichmentSettings.maxAgeYears);

    // Find flights without accepted pending updates
    const flights = await prismaClient.flight.findMany({
      where: {
        userId,
        flightNumber: { not: null },
        departureTime: {
          gte: maxAgeDate,
        },
        NOT: {
          pendingUpdates: {
            some: {
              status: 'applied',
            },
          },
        },
      },
    });

    const candidates: EnrichmentCandidate[] = [];

    for (const flight of flights) {
      const missingFields: string[] = [];
      let missingRoute = false;

      // Check for missing fields
      if (!flight.aircraft) missingFields.push('aircraft');
      if (!flight.depIcao) missingFields.push('depIcao');
      if (!flight.arrIcao) missingFields.push('arrIcao');
      if (!flight.actualRoute || (flight.actualRoute as any[]).length === 0) {
        missingRoute = true;
        missingFields.push('actualRoute');
      }

      if (missingFields.length === 0) {
        continue; // Flight already has all data
      }

      // Calculate age in years
      const ageMs = now.getTime() - flight.departureTime.getTime();
      const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);

      // Basic confidence calculation (will be refined during aggregation)
      const confidence = calculateBasicConfidence(flight, missingFields);

      candidates.push({
        flightId: flight.id,
        flightNumber: flight.flightNumber!,
        missingFields,
        missingRoute,
        ageYears,
        confidence,
      });
    }

    // Sort by confidence (highest first)
    candidates.sort((a, b) => b.confidence - a.confidence);

    return candidates;
  } catch (error) {
    logger.error({
      operation: 'find_enrichment_candidates_error',
      message: 'Failed to find enrichment candidates',
      context: { userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return [];
  }
}

/**
 * Calculate basic confidence for a candidate (before aggregation)
 */
function calculateBasicConfidence(flight: Flight, missingFields: string[]): number {
  let confidence = 50; // Base confidence

  // More confidence if flight number is present
  if (flight.flightNumber) {
    confidence += 20;
  }

  // Less confidence if many fields are missing
  confidence -= missingFields.length * 5;

  // More confidence if at least some data exists
  if (flight.airline) confidence += 10;
  if (flight.depIata || flight.depIcao) confidence += 10;
  if (flight.arrIata || flight.arrIcao) confidence += 10;

  return Math.max(0, Math.min(100, confidence));
}

/**
 * Aggregate flight data from reference flights with the same flight number
 */
export async function aggregateFlightData(
  flightNumber: string,
  excludeFlightId: string,
  minFlights: number = 5
): Promise<AggregatedFlightData | null> {
  try {
    // Find flights with live tracking and same flight number
    const referenceFlights = await prismaClient.flight.findMany({
      where: {
        flightNumber: flightNumber.toUpperCase(),
        id: { not: excludeFlightId },
        hasLiveTracking: true,
        aircraft: { not: null },
        depIcao: { not: null },
        arrIcao: { not: null },
        actualRoute: { not: null as any },
      },
      orderBy: {
        departureTime: 'desc',
      },
      take: 10, // Top 10 newest
    });

    if (referenceFlights.length < minFlights) {
      logger.info({
        operation: 'aggregate_flight_data_insufficient',
        message: 'Not enough reference flights for aggregation',
        context: {
          flightNumber,
          referenceFlightsCount: referenceFlights.length,
          minFlights,
        },
      });
      return null;
    }

    // Aggregate basic fields
    const aircrafts = referenceFlights.map(f => f.aircraft).filter(Boolean) as string[];
    const depIcaos = referenceFlights.map(f => f.depIcao).filter(Boolean) as string[];
    const arrIcaos = referenceFlights.map(f => f.arrIcao).filter(Boolean) as string[];
    const gates = referenceFlights.map(f => f.gate).filter(Boolean) as string[];
    const terminals = referenceFlights.map(f => f.terminal).filter(Boolean) as string[];

    // Calculate most common values
    const mostCommonAircraft = getMostCommon(aircrafts);
    const mostCommonDepIcao = getMostCommon(depIcaos);
    const mostCommonArrIcao = getMostCommon(arrIcaos);
    const mostCommonGate = getMostCommon(gates);
    const mostCommonTerminal = getMostCommon(terminals);

    // Aggregate route data
    const routes = referenceFlights
      .map(f => f.actualRoute)
      .filter(Boolean) as any[];

    const typicalRoute = aggregateRoutes(routes);
    const routeConsistency = calculateRouteConsistency(routes);

    // Detect anomalies
    const anomalies = detectRouteAnomalies(referenceFlights, {
      aircraft: mostCommonAircraft,
      routeConsistency,
    });

    // Calculate confidence
    const confidence = calculateConfidence(
      referenceFlights.length,
      routeConsistency,
      anomalies,
      referenceFlights[0]?.departureTime ? 
        (Date.now() - referenceFlights[0].departureTime.getTime()) / (1000 * 60 * 60 * 24 * 365.25) : 0
    );

    return {
      aircraft: mostCommonAircraft,
      depIcao: mostCommonDepIcao,
      depIata: referenceFlights[0]?.depIata ?? undefined,
      arrIcao: mostCommonArrIcao,
      arrIata: referenceFlights[0]?.arrIata ?? undefined,
      gate: mostCommonGate,
      terminal: mostCommonTerminal,
      typicalRoute,
      sourceFlightsCount: referenceFlights.length,
      confidence,
      anomalies,
      routeConsistency,
    };
  } catch (error) {
    logger.error({
      operation: 'aggregate_flight_data_error',
      message: 'Failed to aggregate flight data',
      context: { flightNumber, excludeFlightId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Get most common value from array
 */
function getMostCommon<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;

  const counts = new Map<T, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  let maxCount = 0;
  let mostCommon: T | undefined;
  for (const [item, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = item;
    }
  }

  return mostCommon;
}

/**
 * Aggregate routes from multiple flights
 */
function aggregateRoutes(routes: any[]): {
  waypoints: Array<{lat: number; lon: number}>;
  overflownCountries: string[];
  routeDistance: number;
} | undefined {
  if (routes.length === 0) return undefined;

  // For now, use the most recent route as typical
  // TODO: Implement proper median/consensus calculation
  const latestRoute = routes[0];
  
  if (!Array.isArray(latestRoute) || latestRoute.length === 0) {
    return undefined;
  }

  // Extract waypoints
  const waypoints = latestRoute
    .filter((wp: any) => wp.lat && wp.lon)
    .map((wp: any) => ({ lat: wp.lat, lon: wp.lon }));

  // Extract countries
  const allCountries = new Set<string>();
  for (const route of routes) {
    if (Array.isArray(route)) {
      for (const wp of route) {
        if (wp.country) {
          allCountries.add(wp.country);
        }
      }
    }
  }

  // Calculate average distance (simplified)
  const distances = routes
    .map((r: any) => r.distance)
    .filter((d: any) => typeof d === 'number');
  const avgDistance = distances.length > 0
    ? distances.reduce((a: number, b: number) => a + b, 0) / distances.length
    : undefined;

  return {
    waypoints,
    overflownCountries: Array.from(allCountries),
    routeDistance: avgDistance || 0,
  };
}

/**
 * Calculate route consistency
 */
function calculateRouteConsistency(routes: any[]): 'high' | 'medium' | 'low' {
  if (routes.length < 3) return 'low';

  // Simplified: Check if routes are similar
  // TODO: Implement proper route comparison
  const uniqueRouteCounts = new Set(routes.map(r => JSON.stringify(r))).size;
  const consistencyRatio = 1 - (uniqueRouteCounts / routes.length);

  if (consistencyRatio > 0.8) return 'high';
  if (consistencyRatio > 0.5) return 'medium';
  return 'low';
}

/**
 * Detect route anomalies
 */
function detectRouteAnomalies(
  referenceFlights: Flight[],
  aggregatedData: { aircraft?: string; routeConsistency: 'high' | 'medium' | 'low' }
): RouteAnomaly[] {
  const anomalies: RouteAnomaly[] = [];

  // Check for aircraft changes
  const uniqueAircrafts = new Set(
    referenceFlights.map(f => f.aircraft).filter(Boolean)
  );
  if (uniqueAircrafts.size > 2) {
    anomalies.push({
      type: 'aircraft_change',
      severity: 'medium',
      description: `Multiple aircraft types found: ${Array.from(uniqueAircrafts).join(', ')}`,
      affectedFlights: uniqueAircrafts.size,
    });
  }

  // Check for route consistency
  if (aggregatedData.routeConsistency === 'low') {
    anomalies.push({
      type: 'route_change',
      severity: 'high',
      description: 'Route has changed significantly (e.g., Russia airspace closure)',
      affectedFlights: referenceFlights.length,
    });
  }

  // Check for inconsistent countries
  const allCountries = new Set<string>();
  for (const flight of referenceFlights) {
    if (flight.overflownCountries && Array.isArray(flight.overflownCountries)) {
      for (const country of flight.overflownCountries) {
        allCountries.add(country);
      }
    }
  }

  if (allCountries.size > referenceFlights.length * 0.5) {
    anomalies.push({
      type: 'inconsistent_countries',
      severity: 'medium',
      description: 'Significant variation in overflown countries',
      affectedFlights: referenceFlights.length,
    });
  }

  return anomalies;
}

/**
 * Calculate confidence score
 */
function calculateConfidence(
  sourceFlightsCount: number,
  routeConsistency: 'high' | 'medium' | 'low',
  anomalies: RouteAnomaly[],
  timeProximity: number // Years since last reference flight
): number {
  let confidence = 50; // Base confidence

  // More flights = higher confidence
  confidence += Math.min(sourceFlightsCount * 5, 30);

  // Route consistency bonus
  if (routeConsistency === 'high') confidence += 20;
  else if (routeConsistency === 'medium') confidence += 10;

  // Anomaly penalties
  for (const anomaly of anomalies) {
    if (anomaly.severity === 'high') confidence -= 15;
    else if (anomaly.severity === 'medium') confidence -= 10;
    else confidence -= 5;
  }

  // Time proximity bonus (newer = better)
  if (timeProximity < 1) confidence += 10;
  else if (timeProximity < 2) confidence += 5;

  return Math.max(0, Math.min(100, confidence));
}

/**
 * Create a pending update for historical enrichment
 */
export async function createHistoricalEnrichment(
  flightId: string,
  aggregatedData: AggregatedFlightData
): Promise<string | null> {
  try {
    const flight = await prismaClient.flight.findUnique({
      where: { id: flightId },
    });

    if (!flight) {
      logger.warn({
        operation: 'create_historical_enrichment_flight_not_found',
        message: 'Flight not found for historical enrichment',
        context: { flightId },
      });
      return null;
    }

    // Get user settings
    const settings = await getUserEnrichmentSettings(flight.userId);
    if (!settings || !settings.enabled) {
      logger.warn({
        operation: 'create_historical_enrichment_disabled',
        message: 'Historical enrichment disabled for user',
        context: { userId: flight.userId, flightId },
      });
      return null;
    }

    // Check confidence threshold
    if (aggregatedData.confidence < settings.minConfidence) {
      logger.info({
        operation: 'create_historical_enrichment_low_confidence',
        message: 'Confidence below threshold',
        context: {
          flightId,
          confidence: aggregatedData.confidence,
          minConfidence: settings.minConfidence,
        },
      });
      return null;
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
      departureTime: flight.departureTime.toISOString(),
      arrivalTime: flight.arrivalTime.toISOString(),
      status: flight.status,
      actualRoute: flight.actualRoute,
      overflownCountries: flight.overflownCountries,
      routeDistance: flight.routeDistance,
    };

    // Create proposed data
    const proposedData = {
      ...originalData,
      aircraft: aggregatedData.aircraft || flight.aircraft,
      depIcao: aggregatedData.depIcao || flight.depIcao,
      depIata: aggregatedData.depIata || flight.depIata,
      arrIcao: aggregatedData.arrIcao || flight.arrIcao,
      arrIata: aggregatedData.arrIata || flight.arrIata,
      gate: aggregatedData.gate || flight.gate,
      terminal: aggregatedData.terminal || flight.terminal,
      actualRoute: aggregatedData.typicalRoute?.waypoints || flight.actualRoute,
      overflownCountries: aggregatedData.typicalRoute?.overflownCountries || flight.overflownCountries,
      routeDistance: aggregatedData.typicalRoute?.routeDistance || flight.routeDistance,
    };

    // Calculate changes
    const { calculateChanges } = await import('./flightAutoUpdate');
    const changes = calculateChanges(originalData, proposedData);

    // Calculate expiry (7 days for historical enrichments)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Calculate statistics impact
    let statisticsImpact: any = null;
    try {
      const { calculateStatisticsImpact } = await import('./pendingUpdateService');
      statisticsImpact = await calculateStatisticsImpact(flight, originalData, proposedData);
    } catch (error) {
      logger.warn({
        operation: 'calculate_statistics_impact_error',
        message: 'Failed to calculate statistics impact',
        context: { flightId: flight.id },
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Create metadata
    const metadata = {
      sourceFlightsCount: aggregatedData.sourceFlightsCount,
      confidence: aggregatedData.confidence,
      anomalies: aggregatedData.anomalies,
      isHistoricalEnrichment: true,
      routeConsistency: aggregatedData.routeConsistency,
    };

    // Check if there's already a pending update
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
          proposedData: proposedData as any,
          changes: changes as any,
          apiSource: 'historical_aggregation',
          fetchedAt: new Date(),
          expiresAt,
          metadata: metadata as any,
          updatedAt: new Date(),
        },
      });
      return updated.id;
    }

    // Create new pending update
    const pendingUpdate = await prismaClient.pendingFlightUpdate.create({
      data: {
        flightId: flight.id,
        userId: flight.userId,
        status: 'pending',
        originalData: originalData as any,
        proposedData: proposedData as any,
        changes: changes as any,
        apiSource: 'historical_aggregation',
        fetchedAt: new Date(),
        expiresAt,
        statisticsImpact: statisticsImpact as any,
        metadata: metadata as any,
      },
    });

    logger.info({
      operation: 'create_historical_enrichment',
      message: 'Created historical enrichment pending update',
      context: {
        pendingUpdateId: pendingUpdate.id,
        flightId: flight.id,
        userId: flight.userId,
        confidence: aggregatedData.confidence,
        sourceFlightsCount: aggregatedData.sourceFlightsCount,
      },
    });

    return pendingUpdate.id;
  } catch (error) {
    logger.error({
      operation: 'create_historical_enrichment_error',
      message: 'Failed to create historical enrichment',
      context: { flightId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

