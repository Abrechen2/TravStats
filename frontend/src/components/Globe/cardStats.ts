// Aggregators that turn the raw `flights` / `cruises` arrays into the
// metadata fields shown on the pinned popup. Pure, no React, no
// network. Each returns a minimal shape with optional fields so the
// card UI can gracefully omit anything we couldn't derive.
//
// Phase B of the Globe pinned-card UX rework — Phase A wired up the
// MapLibre Popup anchor, this file backs the denser content.

import type { GeoJSONFeature } from "../../types";
import type { Cruise } from "../../types/cruise";

export interface AirportCardStats {
  totalVisits: number;
  lastVisitDate: string | null;
  longestRoute: { iata: string; km: number } | null;
  topAirline: string | null;
  topAircraft: string | null;
}

export interface PortCardStats {
  country: string | null;
  region: string | null;
  totalVisits: number;
  lastCallDate: string | null;
  ships: string[];
  longestPortCallMinutes: number | null;
}

export interface ArcCardStats {
  totalKm: number;
  lastFlightDate: string | null;
  /** Most-frequently-flown aircraft type on this route. */
  topAircraft: string | null;
  topAirline: string | null;
}

export interface CruiseCardStats {
  shipName: string | null;
  line: string | null;
  startDate: string | null;
  endDate: string | null;
  portCount: number;
  seaDays: number;
  embarkPort: string | null;
  debarkPort: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────

function modeOf(values: ReadonlyArray<string | undefined | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let topKey: string | null = null;
  let topCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > topCount) {
      topKey = k;
      topCount = c;
    }
  }
  return topKey;
}

function maxDate(dates: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

// ─── Airport ──────────────────────────────────────────────────────

export function getAirportStats(flights: GeoJSONFeature[], iata: string): AirportCardStats {
  const touched = flights.filter(
    (f) => f.properties.departureAirport.iata === iata || f.properties.arrivalAirport.iata === iata
  );
  const departures = touched.filter((f) => f.properties.departureAirport.iata === iata);

  // A scheduled flight must never count as a visit or bump the last-visit
  // date — it's a future plan, not something that happened. Cancelled
  // flights deliberately still count here (status !== "scheduled" keeps
  // them in) — a deferred semantic, not the bug this filter guards against.
  // That's an asymmetry vs. getPortStats below, which filters cruises down
  // to flown|historical explicitly (so cancelled cruises DON'T count as a
  // port call) — both are intentional, just answering different questions.
  const visitedOnly = touched.filter((f) => f.properties.status !== "scheduled");

  // Longest route originating from this airport, by distance.
  let longestRoute: AirportCardStats["longestRoute"] = null;
  for (const f of departures) {
    const arrIata = f.properties.arrivalAirport.iata;
    if (!arrIata) continue;
    const km = f.properties.distance ?? 0;
    if (longestRoute === null || km > longestRoute.km) {
      longestRoute = { iata: arrIata, km };
    }
  }

  return {
    totalVisits: visitedOnly.length,
    lastVisitDate: maxDate(visitedOnly.map((f) => f.properties.departureTime)),
    longestRoute,
    topAirline: modeOf(touched.map((f) => f.properties.airline)),
    topAircraft: modeOf(touched.map((f) => f.properties.aircraft)),
  };
}

// ─── Port ─────────────────────────────────────────────────────────

export function getPortStats(cruises: Cruise[], portKey: string): PortCardStats {
  // `portKey` is whatever the PointDatum carries — historically the
  // marker's iata-or-name slot. Match against unlocode AND name so
  // both code-keyed and name-keyed markers resolve.
  // Only sailed cruises (flown/historical) contribute an actual port call —
  // a scheduled cruise is a future plan, not a visit yet.
  const stops = cruises
    .filter((c) => c.status === "flown" || c.status === "historical")
    .flatMap((c) =>
      c.stops
        .filter(
          (s) =>
            s.port?.unlocode === portKey || s.port?.name === portKey || s.port?.city === portKey
        )
        .map((s) => ({ stop: s, cruise: c }))
    );

  const country = stops[0]?.stop.port?.country ?? null;
  const region = stops[0]?.stop.port?.region ?? null;

  const ships = Array.from(
    new Set(
      stops
        .map(({ cruise }) => cruise.ship?.name ?? cruise.shipNameOverride ?? null)
        .filter((s): s is string => s !== null)
    )
  );

  // Longest port-call: max(departureTime − arrivalTime) for stops with
  // both timestamps populated.
  let longestPortCallMinutes: number | null = null;
  for (const { stop } of stops) {
    if (!stop.arrivalTime || !stop.departureTime) continue;
    const minutes =
      (new Date(stop.departureTime).getTime() - new Date(stop.arrivalTime).getTime()) / 60000;
    if (minutes <= 0 || !Number.isFinite(minutes)) continue;
    if (longestPortCallMinutes === null || minutes > longestPortCallMinutes) {
      longestPortCallMinutes = minutes;
    }
  }

  return {
    country,
    region,
    totalVisits: stops.length,
    lastCallDate: maxDate(stops.map(({ stop }) => stop.arrivalTime)),
    ships,
    longestPortCallMinutes,
  };
}

// ─── Arc (flight route) ───────────────────────────────────────────

export function getArcStats(
  flights: GeoJSONFeature[],
  flightIds: ReadonlyArray<string>
): ArcCardStats {
  const ids = new Set(flightIds);
  const matched = flights.filter((f) => ids.has(f.properties.id));

  const totalKm = matched.reduce((sum, f) => sum + (f.properties.distance ?? 0), 0);

  return {
    totalKm,
    lastFlightDate: maxDate(matched.map((f) => f.properties.departureTime)),
    topAircraft: modeOf(matched.map((f) => f.properties.aircraft)),
    topAirline: modeOf(matched.map((f) => f.properties.airline)),
  };
}

// ─── Cruise ───────────────────────────────────────────────────────

export function getCruiseStats(cruises: Cruise[], cruiseId: string): CruiseCardStats | null {
  const cruise = cruises.find((c) => c.id === cruiseId);
  if (!cruise) return null;

  const portStops = cruise.stops.filter((s) => !s.isAtSea);
  const seaDays = cruise.stops.filter((s) => s.isAtSea).length;

  return {
    shipName: cruise.ship?.name ?? cruise.shipNameOverride ?? null,
    line: cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? null,
    startDate: cruise.startDate,
    endDate: cruise.endDate,
    portCount: portStops.length,
    seaDays,
    embarkPort: cruise.departurePort?.name ?? null,
    debarkPort: cruise.arrivalPort?.name ?? null,
  };
}
