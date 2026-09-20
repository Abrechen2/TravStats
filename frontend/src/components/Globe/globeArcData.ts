// Route aggregation for the globe's flight arcs.
//
// Extracted from GlobeView's inline `useMemo` on 2026-09-20, for the reason
// `globePointData.ts` next door was: the component is frozen at its recorded
// size by the file-size ratchet, this body was already a pure function of the
// memo's dependency list, and it reads better with a name than as 130 lines in
// the middle of a React component.
//
// Every rule in here mirrors the flat map's `routesLayer.ts` deliberately —
// the same route key, the same "weak" fallback when an endpoint has no IATA,
// the same collapse of historical/mixed/past into one "past" bucket, and the
// same `shared/flightCounting` predicate the SERVER counts by. Two renderers
// that aggregated differently would disagree about how often a route was
// flown, on the same screen.

import type { GeoJSONFeature } from "../../types";
import type { ArcDatum } from "./globeLayerTypes";
import { isCountableFlight } from "../../shared/flightCounting";
import {
  ANTIPODAL_DISTANCE_KM,
  calculateDistance,
  createRouteKey,
  endpointIdentity,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "./arcUtils";
import {
  calculateHeatmapThresholds,
  getHeatmapColor,
  getQuartile,
  type HeatmapThresholds,
} from "./heatmapUtils";

export interface GlobeArcData {
  arcsData: ArcDatum[];
  /** Rendered flat at altitude 0 — see the note at the split below. */
  antipodalArcs: ArcDatum[];
  heatmapThresholds: HeatmapThresholds;
}

/**
 * Aggregate flights into per-route arcs, split off the antipodal ones, and
 * compute the frequency quartiles the heat colouring and the panel filter
 * both read.
 */
export function buildGlobeArcData(
  flights: readonly GeoJSONFeature[],
  minRouteCount: number,
  lite: boolean,
  altitudeFactor: number
): GlobeArcData {
  interface RouteAcc {
    count: number;
    from: [number, number];
    to: [number, number];
    flightIds: string[];
    departure: { iata?: string; name?: string };
    arrival: { iata?: string; name?: string };
    weak: boolean;
    // Route carries at least one scheduled flight / at least one
    // flight that's actually been flown (i.e. status !== 'scheduled').
    // Mirrors routesLayer.ts's RouteRecord — combined, these two flags
    // simplify to a "past" vs. "scheduled" two-tone bucket: a route is
    // "scheduled" only when EVERY flight on it is still scheduled.
    hasUpcoming: boolean;
    hasPastFlown: boolean;
    // Status-aware split of `count`, same predicate as routesLayer.ts's
    // RouteRecord — flown = status 'flown'|'historical', scheduled =
    // status 'scheduled'. Threaded through to ArcDatum for the hover
    // tooltip's two-part label.
    flownCount: number;
    scheduledCount: number;
  }
  const routes = new Map<string, RouteAcc>();
  for (const flight of flights) {
    const coords = flight.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const start = coords[0];
    const end = coords[coords.length - 1];
    if (
      ![start[0], start[1], end[0], end[1]].every(Number.isFinite) ||
      (start[0] === 0 && start[1] === 0) ||
      (end[0] === 0 && end[1] === 0)
    ) {
      continue;
    }
    const dep = flight.properties?.departureAirport;
    const arr = flight.properties?.arrivalAirport;
    const depKey = endpointIdentity(dep?.iata, start[0], start[1]);
    const arrKey = endpointIdentity(arr?.iata, end[0], end[1]);
    // Weak when either endpoint had no IATA — endpointIdentity then
    // falls back to a coord-rounded sentinel. This may collapse
    // multiple flights that were similar-but-not-identical routes.
    const flightWeak = !dep?.iata || !arr?.iata;
    const isScheduled = flight.properties?.status === "scheduled";
    // Same predicate as routesLayer.ts's aggregateAllRoutes — literally so
    // now: both read shared/flightCounting, which is also what the server
    // counts by. "Flown" covers 'historical' too (a route already travelled
    // either way).
    const isFlown = isCountableFlight(flight.properties);
    const key = createRouteKey(depKey, arrKey);
    const existing = routes.get(key);
    if (existing) {
      existing.count++;
      existing.flightIds.push(flight.properties.id);
      if (flightWeak) existing.weak = true;
      if (isScheduled) existing.hasUpcoming = true;
      if (!isScheduled) existing.hasPastFlown = true;
      if (isScheduled) existing.scheduledCount += 1;
      if (isFlown) existing.flownCount += 1;
    } else {
      routes.set(key, {
        count: 1,
        from: [start[0], start[1]],
        to: [end[0], end[1]],
        flightIds: [flight.properties.id],
        departure: dep ?? {},
        arrival: arr ?? {},
        weak: flightWeak,
        hasUpcoming: isScheduled,
        hasPastFlown: !isScheduled,
        flownCount: isFlown ? 1 : 0,
        scheduledCount: isScheduled ? 1 : 0,
      });
    }
  }
  const counts = Array.from(routes.values()).map((r) => r.count);
  const thresholds = calculateHeatmapThresholds(counts);
  const arcs: ArcDatum[] = [];
  const antipodals: ArcDatum[] = [];
  for (const r of routes.values()) {
    if (r.count < minRouteCount) continue;
    const distanceKm = calculateDistance(r.from[1], r.from[0], r.to[1], r.to[0]);
    // Antipodal pairs (e.g. SYD↔TFS, ~19 900 km) have a degenerate
    // great circle: the slerp picks an arbitrary polar path. Render
    // them as a flat surface line at altitude 0 so the route still
    // appears visually, but without the polar-ring artifact a high-
    // altitude arc would produce.
    const quartile = getQuartile(r.count, thresholds);
    // Pure-scheduled (never flown) → "scheduled"; everything else
    // (historical-only, mixed, regular past-only) collapses to "past" —
    // mirrors routesLayer.ts's pureScheduled collapsing rule exactly.
    const status: ArcDatum["status"] = r.hasUpcoming && !r.hasPastFlown ? "scheduled" : "past";
    if (distanceKm >= ANTIPODAL_DISTANCE_KM) {
      antipodals.push({
        from: r.from,
        to: r.to,
        waypoints: greatCircleWaypoints(r.from, r.to, 0, getArcSteps(distanceKm, lite)),
        count: r.count,
        flightIds: r.flightIds,
        departure: r.departure,
        arrival: r.arrival,
        color: getHeatmapColor(r.count, thresholds),
        quartile,
        weak: r.weak,
        status,
        flownCount: r.flownCount,
        scheduledCount: r.scheduledCount,
      });
      continue;
    }
    const peakAltitudeM = getArcPeakAltitudeMeters(distanceKm) * altitudeFactor;
    arcs.push({
      from: r.from,
      to: r.to,
      waypoints: greatCircleWaypoints(r.from, r.to, peakAltitudeM, getArcSteps(distanceKm, lite)),
      count: r.count,
      flightIds: r.flightIds,
      departure: r.departure,
      arrival: r.arrival,
      color: getHeatmapColor(r.count, thresholds),
      quartile,
      weak: r.weak,
      status,
      flownCount: r.flownCount,
      scheduledCount: r.scheduledCount,
    });
  }
  return { arcsData: arcs, antipodalArcs: antipodals, heatmapThresholds: thresholds };
}
