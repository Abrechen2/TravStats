import { compareAirportAuthority } from "./airportCache";

/**
 * Where an airport IS, resolved from the catalogue rather than from the copy a
 * flight row happens to carry.
 *
 * Every flight stores its own `depLat`/`depLon`/`arrLat`/`arrLon`, written by
 * whichever source created it. Those copies drift: different providers quote
 * different reference points for one airport, and nothing reconciles them
 * afterwards. Rendering from them puts the same airport in several places at
 * once — the map draws its airport dot from the first-seen flight per airport
 * and each arc from the first-seen flight per route, so the arc visibly misses
 * the dot.
 *
 * `enrichFlightAirports` stops NEW rows from drifting; this index is what makes
 * the rows already in the database render on a single point.
 */

/** Minimal shape this module needs — matches the catalogue `select`. */
export interface AirportCoordinateRow {
  iata: string | null;
  icao: string | null;
  lat: number | null;
  lon: number | null;
  isClosed?: boolean | null;
}

/** GeoJSON order: longitude first. */
export type LonLat = [number, number];

export interface AirportCoordinateIndex {
  readonly byIata: ReadonlyMap<string, LonLat>;
  readonly byIcao: ReadonlyMap<string, LonLat>;
}

/**
 * A catalogue row only counts once it actually carries a position — a row with
 * a null coordinate must not shadow the flight's own value, or the flight would
 * vanish from the map.
 */
function hasPosition(
  row: AirportCoordinateRow,
): row is AirportCoordinateRow & { lat: number; lon: number } {
  return typeof row.lat === "number" && typeof row.lon === "number";
}

/**
 * Build the lookup once per request, from the same batch query that already
 * resolves country and city.
 *
 * The catalogue deliberately keeps closed predecessors under the code people
 * remember them by (MUC is both Munich Airport and Munich-Riem, closed since
 * 1992). Sorting by `compareAirportAuthority` before indexing is what keeps a
 * live flight off a closed airfield's coordinates — the same guarantee every
 * other resolution path relies on.
 */
export function buildAirportCoordinateIndex(
  airports: ReadonlyArray<AirportCoordinateRow>,
): AirportCoordinateIndex {
  const byIata = new Map<string, LonLat>();
  const byIcao = new Map<string, LonLat>();

  const authoritativeFirst = [...airports].sort(compareAirportAuthority);

  for (const airport of authoritativeFirst) {
    if (!hasPosition(airport)) continue;
    const position: LonLat = [airport.lon, airport.lat];
    // First write wins — the list is sorted most-authoritative first.
    if (airport.iata && !byIata.has(airport.iata)) byIata.set(airport.iata, position);
    if (airport.icao && !byIcao.has(airport.icao)) byIcao.set(airport.icao, position);
  }

  return { byIata, byIcao };
}

/**
 * IATA first, then ICAO, then the flight's own copy. The fallback is not a
 * formality: user-added airfields and anything the catalogue never learned
 * still have to render, and their stored coordinate is the only one there is.
 */
export function resolveAirportCoordinate(
  index: AirportCoordinateIndex,
  iata: string | null,
  icao: string | null,
  flightLat: number,
  flightLon: number,
): LonLat {
  const fromCatalogue =
    (iata ? index.byIata.get(iata) : undefined) ?? (icao ? index.byIcao.get(icao) : undefined);

  return fromCatalogue ?? [flightLon, flightLat];
}
