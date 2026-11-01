// Route aggregation and confidence scoring for flight enrichment. Split from
// `flightEnrichmentService.ts` (forgejo#386, REF-16) so the service stays under
// the 800-line limit; the logic is unchanged.

import type { Flight, Prisma } from "../prisma";
import { calculateDistance } from "../utils/geo";
import type { AggregatedFlightData, RouteAnomaly, RouteWaypoint } from "./flightEnrichmentService";

/**
 * Get most common value from array
 */
export function getMostCommon<T>(arr: T[]): T | undefined {
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
    cumDist.push(
      cumDist[i - 1] + calculateDistance(wps[i - 1].lat, wps[i - 1].lon, wps[i].lat, wps[i].lon)
    );
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
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregate multiple routes into a typical route using resampling + median.
 * Exported for testing.
 */
export function aggregateRoutesForTest(rawRoutes: Array<Array<{ lat: number; lon: number }>>):
  | {
      waypoints: Array<{ lat: number; lon: number }>;
      overflownCountries: string[];
      routeDistance: number;
    }
  | undefined {
  const validRoutes = rawRoutes.filter((r) => r.length >= 2);
  if (validRoutes.length === 0) return undefined;

  const resampled = validRoutes.map((r) => resampleRoute(r, RESAMPLE_POINTS));

  const waypoints: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < RESAMPLE_POINTS; i++) {
    waypoints.push({
      lat: medianOf(resampled.map((r) => r[i].lat)),
      lon: medianOf(resampled.map((r) => r[i].lon)),
    });
  }

  // Sum Haversine distances along the median route for accurate km estimate
  let routeDistance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    routeDistance += calculateDistance(
      waypoints[i - 1].lat,
      waypoints[i - 1].lon,
      waypoints[i].lat,
      waypoints[i].lon
    );
  }

  return { waypoints, overflownCountries: [], routeDistance };
}

/**
 * Aggregate routes from Prisma JsonValue array.
 * Internal wrapper used by aggregateFlightData.
 */
export function aggregateRoutes(routes: Prisma.JsonValue[]): AggregatedFlightData["typicalRoute"] {
  const parsed = routes
    .filter(Array.isArray)
    .map((r) =>
      (r as Prisma.JsonValue[])
        .filter(
          (wp): wp is Prisma.JsonObject =>
            typeof wp === "object" &&
            wp !== null &&
            !Array.isArray(wp) &&
            typeof wp["lat"] === "number" &&
            typeof wp["lon"] === "number"
        )
        .map((wp) => ({ lat: wp["lat"] as number, lon: wp["lon"] as number }))
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
          typeof wp === "object" &&
          wp !== null &&
          !Array.isArray(wp) &&
          typeof (wp as Prisma.JsonObject)["country"] === "string"
        ) {
          allCountries.add((wp as Prisma.JsonObject)["country"] as string);
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
    .filter(
      (w): w is { lat: number; lon: number } =>
        typeof w === "object" &&
        w !== null &&
        typeof (w as { lat?: unknown }).lat === "number" &&
        typeof (w as { lon?: unknown }).lon === "number"
    )
    .map((w) => ({ lat: w.lat, lon: w.lon }));
  return parsed.length >= 2 ? parsed : null;
}

/**
 * Calculate route consistency by comparing resampled geographic paths.
 * Two routes are "similar" if their average Haversine deviation is < 150 km.
 */
export function calculateRouteConsistency(routes: Prisma.JsonValue[]): "high" | "medium" | "low" {
  if (routes.length < 3) return "low";

  const SAMPLE_POINTS = 10;
  const SIMILAR_THRESHOLD_KM = 150;

  const resampled = routes
    .map((r) => parseRouteWaypoints(r))
    .filter((wps): wps is RouteWaypoint[] => wps !== null)
    .map((wps) => resampleRoute(wps, SAMPLE_POINTS));

  if (resampled.length < 3) return "low";

  // Use the first route as reference and count how many are "similar"
  const reference = resampled[0];
  let similarCount = 0;
  for (let i = 1; i < resampled.length; i++) {
    const avgDev =
      reference.reduce(
        (sum, pt, j) =>
          sum + calculateDistance(pt.lat, pt.lon, resampled[i][j].lat, resampled[i][j].lon),
        0
      ) / SAMPLE_POINTS;
    if (avgDev < SIMILAR_THRESHOLD_KM) similarCount++;
  }

  const similarRatio = similarCount / (resampled.length - 1);
  if (similarRatio > 0.8) return "high";
  if (similarRatio > 0.5) return "medium";
  return "low";
}

/**
 * Detect route anomalies
 */
export function detectRouteAnomalies(
  referenceFlights: Flight[],
  aggregatedData: { aircraft?: string; routeConsistency: "high" | "medium" | "low" }
): RouteAnomaly[] {
  const anomalies: RouteAnomaly[] = [];

  // Check for aircraft changes
  const uniqueAircrafts = new Set(referenceFlights.map((f) => f.aircraft).filter(Boolean));
  if (uniqueAircrafts.size > 2) {
    anomalies.push({
      type: "aircraft_change",
      severity: "medium",
      description: `Multiple aircraft types found: ${Array.from(uniqueAircrafts).join(", ")}`,
      affectedFlights: uniqueAircrafts.size,
    });
  }

  // Check for route consistency
  if (aggregatedData.routeConsistency === "low") {
    anomalies.push({
      type: "route_change",
      severity: "high",
      description: "Route has changed significantly (e.g., Russia airspace closure)",
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
      type: "inconsistent_countries",
      severity: "medium",
      description: "Significant variation in overflown countries",
      affectedFlights: referenceFlights.length,
    });
  }

  return anomalies;
}

/**
 * Calculate confidence score
 */
export function calculateConfidence(
  sourceFlightsCount: number,
  routeConsistency: "high" | "medium" | "low",
  anomalies: RouteAnomaly[],
  timeProximity: number // Years since last reference flight
): number {
  let confidence = 50; // Base confidence

  // More flights = higher confidence
  confidence += Math.min(sourceFlightsCount * 5, 30);

  // Route consistency bonus
  if (routeConsistency === "high") confidence += 20;
  else if (routeConsistency === "medium") confidence += 10;

  // Anomaly penalties
  for (const anomaly of anomalies) {
    if (anomaly.severity === "high") confidence -= 15;
    else if (anomaly.severity === "medium") confidence -= 10;
    else confidence -= 5;
  }

  // Time proximity bonus (newer = better)
  if (timeProximity < 1) confidence += 10;
  else if (timeProximity < 2) confidence += 5;

  return Math.max(0, Math.min(100, confidence));
}
