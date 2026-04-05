/**
 * Flight Enrichment Service
 *
 * Handles historical flight data enrichment by aggregating data from
 * live-tracked flights with the same flight number.
 */

import { PrismaClient, Flight, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { calculateDistance } from '../utils/geo';
import logger from '../utils/logger';

const prismaClient = prisma as PrismaClient;

/** Waypoint in a flight route */
interface RouteWaypoint {
  lat: number;
  lon: number;
  country?: string;
}


export type EnrichmentMode = 'full' | 'slim';

export interface UserEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

export interface EnrichmentCandidate {
  flightId: string;
  flightNumber: string;
  missingFields: string[];
  missingRoute: boolean;
  ageYears: number;
  confidence: number;
  enrichmentMode: EnrichmentMode;
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
      maxPerDay: userSettings.historicalEnrichmentMaxPerDay ?? 50,
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
 * Determine enrichment mode based on flight age.
 * < 1 year  → full  (aircraft, ICAO, route, terminal, gate)
 * ≥ 1 year  → slim  (ICAO codes + terminal only)
 */
export function getEnrichmentMode(departureTime: Date): EnrichmentMode {
  const ageMs = Date.now() - departureTime.getTime();
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
  return ageYears < 1 ? 'full' : 'slim';
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
    const MAX_ENRICHMENT_AGE_YEARS = 10;
    const maxAgeDate = new Date();
    maxAgeDate.setFullYear(maxAgeDate.getFullYear() - MAX_ENRICHMENT_AGE_YEARS);

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
              status: { in: ['applied', 'pending', 'rejected'] },
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
      if (!flight.actualRoute || (Array.isArray(flight.actualRoute) && flight.actualRoute.length === 0)) {
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
        enrichmentMode: getEnrichmentMode(flight.departureTime),
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
 * Aggregate flight data from reference flights with the same flight number.
 *
 * @param userId - When provided, gate and terminal are sourced exclusively from this
 *   user's own live-tracked flights rather than from the cross-user reference set.
 *   Route geometry (ICAO codes, waypoints) is intentionally cross-user: it represents
 *   shared public flight-path data, not personal information.
 */
export async function aggregateFlightData(
  flightNumber: string,
  excludeFlightId: string,
  minFlights: number = 5,
  mode: EnrichmentMode = 'full',
  userId?: string
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
        actualRoute: { not: Prisma.DbNull },
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

    // Reference flights are intentionally cross-user: route geometry (ICAO codes, waypoints)
    // is shared public data that represents the flight path, not user-specific information.
    // Gate and terminal are personal data — they are sourced from the requesting user's own
    // flights only (when userId is provided).

    // Always collected (stable across time)
    const depIcaos = referenceFlights.map(f => f.depIcao).filter(Boolean) as string[];
    const arrIcaos = referenceFlights.map(f => f.arrIcao).filter(Boolean) as string[];

    const mostCommonDepIcao = getMostCommon(depIcaos);
    const mostCommonArrIcao = getMostCommon(arrIcaos);

    // Terminal: use only the requesting user's own flights when userId is known.
    // Falls back to cross-user terminal data only when userId is not provided (legacy path).
    let mostCommonTerminal: string | undefined;
    if (userId) {
      const ownFlightsForTerminal = await prismaClient.flight.findMany({
        where: {
          flightNumber: flightNumber.toUpperCase(),
          id: { not: excludeFlightId },
          userId,
          hasLiveTracking: true,
          terminal: { not: null },
        },
        select: { terminal: true },
      });
      mostCommonTerminal = getMostCommon(
        ownFlightsForTerminal.map(f => f.terminal).filter(Boolean) as string[]
      );
    } else {
      mostCommonTerminal = getMostCommon(
        referenceFlights.map(f => f.terminal).filter(Boolean) as string[]
      );
    }

    // Full mode only (unreliable for flights ≥1 year old)
    let mostCommonAircraft: string | undefined;
    let mostCommonGate: string | undefined;
    let typicalRoute: AggregatedFlightData['typicalRoute'];
    let routeConsistency: 'high' | 'medium' | 'low' = 'low';

    if (mode === 'full') {
      const aircrafts = referenceFlights.map(f => f.aircraft).filter(Boolean) as string[];
      mostCommonAircraft = getMostCommon(aircrafts);

      // Gate: use only the requesting user's own flights when userId is known.
      if (userId) {
        const ownFlightsForGate = await prismaClient.flight.findMany({
          where: {
            flightNumber: flightNumber.toUpperCase(),
            id: { not: excludeFlightId },
            userId,
            hasLiveTracking: true,
            gate: { not: null },
          },
          select: { gate: true },
        });
        mostCommonGate = getMostCommon(
          ownFlightsForGate.map(f => f.gate).filter(Boolean) as string[]
        );
      } else {
        const gates = referenceFlights.map(f => f.gate).filter(Boolean) as string[];
        mostCommonGate = getMostCommon(gates);
      }

      const routes = referenceFlights
        .map(f => f.actualRoute)
        .filter(Boolean) as Prisma.JsonValue[];
      typicalRoute = aggregateRoutes(routes);
      routeConsistency = calculateRouteConsistency(routes);
    }

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
      referenceFlights[0]?.departureTime
        ? (Date.now() - referenceFlights[0].departureTime.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
        : 0
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

const RESAMPLE_POINTS = 20;

/** Resample a route to exactly n evenly-spaced points using Haversine distances */
function resampleRoute(
  wps: Array<{ lat: number; lon: number }>,
  n: number
): Array<{ lat: number; lon: number }> {
  if (wps.length === 0) return [];
  if (wps.length === 1) return Array(n).fill({ ...wps[0] });

  const cumDist: number[] = [0];
  for (let i = 1; i < wps.length; i++) {
    cumDist.push(cumDist[i - 1] + calculateDistance(wps[i - 1].lat, wps[i - 1].lon, wps[i].lat, wps[i].lon));
  }
  const totalDist = cumDist[cumDist.length - 1];
  if (totalDist === 0) return Array(n).fill({ ...wps[0] });

  const result: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * totalDist;
    let seg = cumDist.findIndex((d, idx) => idx > 0 && cumDist[idx - 1] <= target && d >= target);
    if (seg <= 0) seg = 1;
    const segStart = cumDist[seg - 1];
    const segEnd = cumDist[seg];
    const t = segEnd === segStart ? 0 : (target - segStart) / (segEnd - segStart);
    result.push({
      lat: wps[seg - 1].lat + t * (wps[seg].lat - wps[seg - 1].lat),
      lon: wps[seg - 1].lon + t * (wps[seg].lon - wps[seg - 1].lon),
    });
  }
  return result;
}

/** Median of a number array */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregate multiple routes into a typical route using resampling + median.
 * Exported for testing.
 */
export function aggregateRoutesForTest(
  rawRoutes: Array<Array<{ lat: number; lon: number }>>
): { waypoints: Array<{ lat: number; lon: number }>; overflownCountries: string[]; routeDistance: number } | undefined {
  const validRoutes = rawRoutes.filter(r => r.length >= 2);
  if (validRoutes.length === 0) return undefined;

  const resampled = validRoutes.map(r => resampleRoute(r, RESAMPLE_POINTS));

  const waypoints: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < RESAMPLE_POINTS; i++) {
    waypoints.push({
      lat: medianOf(resampled.map(r => r[i].lat)),
      lon: medianOf(resampled.map(r => r[i].lon)),
    });
  }

  // Sum Haversine distances along the median route for accurate km estimate
  let routeDistance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    routeDistance += calculateDistance(waypoints[i - 1].lat, waypoints[i - 1].lon, waypoints[i].lat, waypoints[i].lon);
  }

  return { waypoints, overflownCountries: [], routeDistance };
}

/**
 * Aggregate routes from Prisma JsonValue array.
 * Internal wrapper used by aggregateFlightData.
 */
function aggregateRoutes(routes: Prisma.JsonValue[]): AggregatedFlightData['typicalRoute'] {
  const parsed = routes
    .filter(Array.isArray)
    .map((r) =>
      (r as Prisma.JsonValue[])
        .filter(
          (wp): wp is Prisma.JsonObject =>
            typeof wp === 'object' && wp !== null && !Array.isArray(wp) &&
            typeof wp['lat'] === 'number' && typeof wp['lon'] === 'number'
        )
        .map((wp) => ({ lat: wp['lat'] as number, lon: wp['lon'] as number }))
    )
    .filter((r) => r.length >= 2);

  const result = aggregateRoutesForTest(parsed);
  if (!result) return undefined;

  // Collect overflown countries from all routes
  const allCountries = new Set<string>();
  for (const route of routes) {
    if (Array.isArray(route)) {
      for (const wp of route) {
        if (
          typeof wp === 'object' && wp !== null && !Array.isArray(wp) &&
          typeof (wp as Prisma.JsonObject)['country'] === 'string'
        ) {
          allCountries.add((wp as Prisma.JsonObject)['country'] as string);
        }
      }
    }
  }

  return {
    ...result,
    overflownCountries: Array.from(allCountries),
  };
}

/**
 * Parse a Prisma JsonValue route into waypoints.
 * actualRoute is stored as a direct array of {lat, lon} objects.
 */
function parseRouteWaypoints(route: Prisma.JsonValue): RouteWaypoint[] | null {
  if (!Array.isArray(route)) return null;
  const parsed = route
    .filter((w): w is { lat: number; lon: number } =>
      typeof w === 'object' && w !== null &&
      typeof (w as { lat?: unknown }).lat === 'number' &&
      typeof (w as { lon?: unknown }).lon === 'number',
    )
    .map(w => ({ lat: w.lat, lon: w.lon }));
  return parsed.length >= 2 ? parsed : null;
}

/**
 * Calculate route consistency by comparing resampled geographic paths.
 * Two routes are "similar" if their average Haversine deviation is < 150 km.
 */
function calculateRouteConsistency(routes: Prisma.JsonValue[]): 'high' | 'medium' | 'low' {
  if (routes.length < 3) return 'low';

  const SAMPLE_POINTS = 10;
  const SIMILAR_THRESHOLD_KM = 150;

  const resampled = routes
    .map(r => parseRouteWaypoints(r))
    .filter((wps): wps is RouteWaypoint[] => wps !== null)
    .map(wps => resampleRoute(wps, SAMPLE_POINTS));

  if (resampled.length < 3) return 'low';

  // Use the first route as reference and count how many are "similar"
  const reference = resampled[0];
  let similarCount = 0;
  for (let i = 1; i < resampled.length; i++) {
    const avgDev =
      reference.reduce((sum, pt, j) => sum + calculateDistance(pt.lat, pt.lon, resampled[i][j].lat, resampled[i][j].lon), 0) /
      SAMPLE_POINTS;
    if (avgDev < SIMILAR_THRESHOLD_KM) similarCount++;
  }

  const similarRatio = similarCount / (resampled.length - 1);
  if (similarRatio > 0.8) return 'high';
  if (similarRatio > 0.5) return 'medium';
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
  aggregatedData: AggregatedFlightData,
  userId?: string
): Promise<string | null> {
  try {
    const flight = userId
      ? await prismaClient.flight.findFirst({ where: { id: flightId, userId } })
      : await prismaClient.flight.findUnique({ where: { id: flightId } });

    if (!flight) {
      logger.warn({
        operation: 'create_historical_enrichment_flight_not_found',
        message: 'Flight not found for historical enrichment',
        context: { flightId },
      });
      return null;
    }

    const mode = getEnrichmentMode(flight.departureTime);

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
    const proposedData =
      mode === 'full'
        ? {
            ...originalData,
            aircraft: aggregatedData.aircraft ?? flight.aircraft,
            depIcao: aggregatedData.depIcao ?? flight.depIcao,
            depIata: aggregatedData.depIata ?? flight.depIata,
            arrIcao: aggregatedData.arrIcao ?? flight.arrIcao,
            arrIata: aggregatedData.arrIata ?? flight.arrIata,
            gate: aggregatedData.gate ?? flight.gate,
            terminal: aggregatedData.terminal ?? flight.terminal,
            actualRoute: aggregatedData.typicalRoute?.waypoints ?? flight.actualRoute,
            overflownCountries: aggregatedData.typicalRoute?.overflownCountries ?? flight.overflownCountries,
            routeDistance: aggregatedData.typicalRoute?.routeDistance ?? flight.routeDistance,
          }
        : {
            // Slim mode: only ICAO codes and terminal — aircraft and route are unreliable for old flights
            ...originalData,
            depIcao: aggregatedData.depIcao ?? flight.depIcao,
            depIata: aggregatedData.depIata ?? flight.depIata,
            arrIcao: aggregatedData.arrIcao ?? flight.arrIcao,
            arrIata: aggregatedData.arrIata ?? flight.arrIata,
            terminal: aggregatedData.terminal ?? flight.terminal,
          };

    // Calculate changes
    const { calculateChanges } = await import('./flightAutoUpdate');
    const changes = calculateChanges(originalData, proposedData);

    // Calculate expiry (7 days for historical enrichments)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Calculate statistics impact
    let statisticsImpact: Prisma.InputJsonValue | null = null;
    try {
      const { calculateStatisticsImpact } = await import('./pendingUpdateService');
      const impact = await calculateStatisticsImpact(flight, originalData, proposedData);
      // Convert Set objects in the impact to arrays for JSON serialization
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

    // Create metadata
    const metadata = {
      sourceFlightsCount: aggregatedData.sourceFlightsCount,
      confidence: aggregatedData.confidence,
      anomalies: aggregatedData.anomalies,
      isHistoricalEnrichment: true,
      enrichmentMode: mode,
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
          proposedData: proposedData as unknown as Prisma.InputJsonValue,
          changes: changes as unknown as Prisma.InputJsonValue,
          apiSource: 'historical_aggregation',
          fetchedAt: new Date(),
          expiresAt,
          metadata: metadata as unknown as Prisma.InputJsonValue,
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
        originalData: originalData as unknown as Prisma.InputJsonValue,
        proposedData: proposedData as unknown as Prisma.InputJsonValue,
        changes: changes as unknown as Prisma.InputJsonValue,
        apiSource: 'historical_aggregation',
        fetchedAt: new Date(),
        expiresAt,
        statisticsImpact: statisticsImpact as Prisma.InputJsonValue,
        metadata: metadata as unknown as Prisma.InputJsonValue,
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
