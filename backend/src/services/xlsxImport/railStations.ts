/**
 * The two stations of a rail row, from the cells the rail sheet writes: the
 * name, the UIC/EVA code and — since the sheet carries them — the position.
 *
 * Resolved in the order that trusts the most reliable cell first:
 *
 *   1. A seven- or eight-digit code the catalogue knows → that catalogue row
 *      (position, code, country); the name stays the file's.
 *   2. A position → the file's station as it is, with the country its
 *      coordinates lie in — the geocoder stations outside the catalogue, and
 *      every station of a file moved between accounts, come back this way.
 *   3. A name alone → the catalogue station whose folded name IS that name,
 *      when exactly one is. A near match is not taken: a wrong station moves
 *      the ride, and a refused row says so where a wrong one would not.
 *
 * Nothing resolves → null, and the caller refuses the row.
 */

import type { RailStationInput } from "../../schemas/rail";
import type { CountryResolver } from "../geo/countryFromCoordinates";
import { foldStationName, searchStations, type RailStationHit } from "../rail/railStations";
import * as cell from "./cells";
import { norm } from "./context";

export type RailEnd = "dep" | "arr";

export interface StationCells {
  name?: string;
  code?: string;
  lat?: number;
  lon?: number;
}

const COORD_EPSILON = 1e-5;
const NAME_CANDIDATES = 5;

/** The station cells of one end, or "invalid" when a coordinate is not a number. */
export function stationCells(raw: Record<string, string>, end: RailEnd): StationCells | "invalid" {
  const lat = cell.num(raw[`${end}Lat`]);
  const lon = cell.num(raw[`${end}Lon`]);
  if ((lat !== undefined && Number.isNaN(lat)) || (lon !== undefined && Number.isNaN(lon))) {
    return "invalid";
  }
  if ((lat !== undefined && Math.abs(lat) > 90) || (lon !== undefined && Math.abs(lon) > 180)) {
    return "invalid";
  }
  return {
    name: cell.text(raw[`${end}StationName`]),
    code: cell.text(raw[`${end}StationCode`]),
    lat,
    lon,
  };
}

/** True when the cells say nothing the stored end does not already say. */
export function sameStation(
  cells: StationCells,
  stored: { name: string; code: string | null; lat: number; lon: number }
): boolean {
  const close = (a: number | undefined, b: number) =>
    a === undefined || Math.abs(a - b) < COORD_EPSILON;
  return (
    (cells.name === undefined || norm(cells.name) === norm(stored.name)) &&
    (cells.code === undefined || cells.code === stored.code) &&
    close(cells.lat, stored.lat) &&
    close(cells.lon, stored.lon)
  );
}

function fromCatalogue(hit: RailStationHit, name: string | undefined): RailStationInput {
  return {
    stationId: hit.id,
    name: name ?? hit.name,
    code: hit.uic ?? hit.dbId,
    lat: hit.lat,
    lon: hit.lon,
    country: hit.country,
  };
}

export async function resolveStation(
  cells: StationCells,
  countryAt: CountryResolver
): Promise<RailStationInput | null> {
  if (cells.code && /^\d{7,8}$/.test(cells.code)) {
    const [hit] = await searchStations(cells.code, 1);
    if (hit) return fromCatalogue(hit, cells.name);
  }
  if (cells.lat !== undefined && cells.lon !== undefined && cells.name) {
    return {
      stationId: null,
      name: cells.name,
      code: cells.code ?? null,
      lat: cells.lat,
      lon: cells.lon,
      country: countryAt.countryAt(cells.lat, cells.lon),
    };
  }
  if (cells.name) {
    const wanted = foldStationName(cells.name);
    const exact = (await searchStations(cells.name, NAME_CANDIDATES)).filter(
      (s) => foldStationName(s.name) === wanted
    );
    if (exact.length === 1) return fromCatalogue(exact[0], cells.name);
  }
  return null;
}
