import { isCountableFlight } from "../../shared/flightCounting";
import type { GeoJSONFeature } from "../../types";
import {
  calculateDistance,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "./arcUtils";
import { getQuartile } from "./heatmapUtils";
import type { ArcDatum, CruisePathDatum, PointDatum } from "./globeLayerTypes";

/**
 * Live-mode head marker: in live slider mode, the single most recent flight
 * (latest departureTime) as its own great-circle arc. Rendered as a wider,
 * brand-orange overlay so the eye tracks "what just happened" as the slider
 * moves. Null outside live mode.
 */
export function buildHeadFlightArc(
  sliderMode: string,
  filteredFlights: readonly GeoJSONFeature[],
  lite: boolean,
  altitudeFactor: number,
  arcBaseOffset: number
): ArcDatum | null {
  if (sliderMode !== "live" || filteredFlights.length === 0) return null;
  let latest: GeoJSONFeature | null = null;
  let latestT = -Infinity;
  for (const f of filteredFlights) {
    const dateStr = f.properties?.departureTime;
    if (!dateStr) continue;
    const t = new Date(dateStr).getTime();
    if (Number.isNaN(t)) continue;
    if (t > latestT) {
      latestT = t;
      latest = f;
    }
  }
  if (!latest) return null;
  const coords = latest.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const start = coords[0];
  const end = coords[coords.length - 1];
  if (![start[0], start[1], end[0], end[1]].every(Number.isFinite)) return null;
  const distanceKm = calculateDistance(start[1], start[0], end[1], end[0]);
  const peakAltitudeM = getArcPeakAltitudeMeters(distanceKm) * altitudeFactor;
  const isScheduled = latest.properties?.status === "scheduled";
  const isFlown = isCountableFlight(latest.properties);
  return {
    from: [start[0], start[1]],
    to: [end[0], end[1]],
    waypoints: greatCircleWaypoints(
      [start[0], start[1]],
      [end[0], end[1]],
      peakAltitudeM,
      getArcSteps(distanceKm, lite),
      arcBaseOffset
    ),
    count: 1,
    flightIds: [latest.properties.id],
    color: [240, 169, 71],
    quartile: getQuartile(1, { q25: 1, q50: 1, q75: 1, max: 1 }),
    departure: latest.properties.departureAirport ?? {},
    arrival: latest.properties.arrivalAirport ?? {},
    weak: false,
    status: isScheduled ? "scheduled" : "past",
    flownCount: isFlown ? 1 : 0,
    scheduledCount: isScheduled ? 1 : 0,
  };
}

export interface GlobeLiveStats {
  flights: number;
  routes: number;
  flightKm: number;
  cruises: number;
  ports: number;
  topAirport: PointDatum | null;
}

/**
 * Live stats overlay: derived from the same slider-filtered data as the
 * layers, so the numbers move in lockstep with the time slider.
 */
export function computeGlobeLiveStats(
  filteredFlights: readonly GeoJSONFeature[],
  airportPoints: readonly PointDatum[],
  cruisePaths: readonly CruisePathDatum[],
  portPoints: readonly PointDatum[],
  arcsData: readonly ArcDatum[],
  antipodalArcs: readonly ArcDatum[]
): GlobeLiveStats {
  let flightKm = 0;
  for (const f of filteredFlights) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const start = coords[0];
    const end = coords[coords.length - 1];
    if (![start[0], start[1], end[0], end[1]].every(Number.isFinite)) continue;
    flightKm += calculateDistance(start[1], start[0], end[1], end[0]);
  }
  const topAirport = airportPoints.reduce<PointDatum | null>(
    (best, p) => (best && best.size >= p.size ? best : p),
    null
  );
  const cruiseCount = new Set(cruisePaths.map((c) => c.cruiseId)).size;
  return {
    flights: filteredFlights.length,
    routes: arcsData.filter((a) => !a.recorded).length + antipodalArcs.length,
    flightKm: Math.round(flightKm),
    cruises: cruiseCount,
    ports: portPoints.length,
    topAirport,
  };
}
