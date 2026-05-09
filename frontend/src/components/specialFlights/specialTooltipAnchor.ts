/**
 * Picks a sensible geographic tooltip anchor for a Sonder-Flug.
 *
 * The generic midpoint between `depLon/arrLon` that DeckGLMap uses for
 * regular airline arcs doesn't match the visual of the special-flight
 * layers — e.g. a sightseeing ring sits at `dep` (=arr), and an eclipse
 * chase visually hangs off the event coords, not off the arrival
 * airport. This helper mirrors the rendering decisions made inside
 * `buildSpecialFlightData` so the tooltip arrow points at the shape the
 * user actually clicked.
 *
 * Pure function — no deck.gl imports, easy to unit test.
 */
import type { Flight } from "../../types";

export type LonLat = [number, number];

function hasCoord(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Returns `[lon, lat]` or `null` when no usable coordinate exists. */
export function getSpecialTooltipAnchor(flight: Flight): LonLat | null {
  const depLon = hasCoord(flight.depLon) ? flight.depLon : null;
  const depLat = hasCoord(flight.depLat) ? flight.depLat : null;
  const arrLon = hasCoord(flight.arrLon) ? flight.arrLon : null;
  const arrLat = hasCoord(flight.arrLat) ? flight.arrLat : null;

  const dep: LonLat | null = depLon != null && depLat != null ? [depLon, depLat] : null;
  const arr: LonLat | null = arrLon != null && arrLat != null ? [arrLon, arrLat] : null;

  const t = flight.specialType;

  // ZeroG — prefer pattern center when provided, fall back to departure.
  if (t === "zerog") {
    if (hasCoord(flight.patternLon) && hasCoord(flight.patternLat)) {
      return [flight.patternLon, flight.patternLat];
    }
    return dep;
  }

  // Eclipse — anchor on the event coords when available so the tooltip
  // sits on the visible marker rather than out at the arrival airport.
  if (t === "eclipse") {
    if (hasCoord(flight.eventLon) && hasCoord(flight.eventLat)) {
      return [flight.eventLon, flight.eventLat];
    }
    if (dep && arr) {
      return [(dep[0] + arr[0]) / 2, (dep[1] + arr[1]) / 2];
    }
    return dep ?? arr;
  }

  // Rocket launch / sightseeing — both sit at the departure airport.
  if (t === "rocket_launch" || t === "sightseeing") {
    return dep ?? arr;
  }

  // aurora / training / ferry / test — standard arc, use midpoint.
  if (dep && arr) {
    return [(dep[0] + arr[0]) / 2, (dep[1] + arr[1]) / 2];
  }
  return dep ?? arr;
}
