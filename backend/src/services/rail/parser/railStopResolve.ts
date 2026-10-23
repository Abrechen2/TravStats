import { prisma } from "../../../db";
import { calculateDistance } from "../../../utils/geo";
import { zoneOf } from "../../../shared/time/zoneOf";
import { getCountryResolver } from "../../geo/countryFromCoordinates";
import {
  STATION_SELECT,
  catalogueStation,
  oneStation,
  resolveStationName,
  unresolvedStation,
  type RailStationCandidate,
} from "./railCandidates";
import type { ProviderStop } from "./types";

/**
 * A stop of a bahn.de connection, resolved from what bahn.de itself sends
 * (2026-10-23): its EVA number, its position, its name — in that order. The
 * catalogue is Trainline's station list; a tram or bus stop of a city's own
 * network is mostly not in it, and the tester deleted every such leg by hand
 * because it could not be saved. No catalogue row is written and nothing is
 * geocoded: a stop the catalogue does not hold keeps bahn.de's position.
 *
 * 1. The EVA number against the catalogue's `db_id` (Deutsche Bahn's number —
 *    NOT Trainline's own id, and not the UIC code: Frankfurt (Main) Hbf is UIC
 *    8011068 but EVA 8000105). Trusted only where it lies within
 *    `PROVIDER_AGREES_KM` of bahn.de's position; a row further off is flagged.
 * 2. The printed name, as for any ticket — but among namesakes only the row at
 *    bahn.de's position, never the first one found.
 * 3. bahn.de's own name and position, with no station id. Its country and zone
 *    come from the coordinates, as for every coordinate-only rail end
 *    (`xlsxImport/rail.ts`): never assumed to be Germany.
 * 4. Without a usable position: unresolved, and the review asks, as before.
 */

/**
 * How far bahn.de's position and a catalogue row may lie apart and still be
 * the same stop. A station complex — Hbf, Hbf (tief), its bus bays — spans
 * about a kilometre in the catalogue, and some rows sit on their town's centre
 * a few kilometres off; namesakes that are different places lie further apart
 * than that (Neufahrn b Freising and Neufahrn i NB: 60 km), and an EVA number
 * that now names another stop lands in another town. 5 km keeps the first two
 * and refuses the last two.
 */
export const PROVIDER_AGREES_KM = 5;

type CountryAt = () => Promise<(lat: number, lon: number) => string | null>;

/** The country boundaries, loaded only when a stop needs them, once per review. */
export function lazyCountryResolver(): CountryAt {
  let loaded: Promise<(lat: number, lon: number) => string | null> | null = null;
  return () => {
    loaded ??= getCountryResolver().then(
      (r) => (lat: number, lon: number) => r.countryAt(lat, lon)
    );
    return loaded;
  };
}

async function byEva(
  eva: string,
  position: ProviderStop["position"]
): Promise<{ match: RailStationCandidate | null; conflictKm: number | null }> {
  const rows = await prisma.railStation.findMany({
    where: { dbId: eva },
    select: STATION_SELECT,
    orderBy: { id: "asc" },
    take: 10,
  });
  const row = oneStation(rows);
  if (!row) return { match: null, conflictKm: null };
  if (!position) return { match: catalogueStation(row, row.name), conflictKm: null };
  const km = calculateDistance(position.lat, position.lon, row.lat, row.lon);
  return km <= PROVIDER_AGREES_KM
    ? { match: catalogueStation(row, row.name), conflictKm: null }
    : { match: null, conflictKm: Math.round(km) };
}

async function providerStation(
  printedName: string,
  stop: ProviderStop & { position: { lat: number; lon: number } },
  countryAt: CountryAt,
  conflictKm: number | null
): Promise<RailStationCandidate> {
  const { lat, lon } = stop.position;
  return {
    ...unresolvedStation(printedName),
    code: stop.eva,
    lat,
    lon,
    country: (await countryAt())(lat, lon),
    timezone: zoneOf({ lat, lon }),
    positionSource: "provider",
    catalogueConflictKm: conflictKm,
  };
}

export async function resolveProviderStop(
  printedName: string,
  stop: ProviderStop,
  countryAt: CountryAt = lazyCountryResolver()
): Promise<RailStationCandidate> {
  const { match, conflictKm } = stop.eva
    ? await byEva(stop.eva, stop.position)
    : { match: null, conflictKm: null };
  if (match) return match;
  const near = stop.position ? { ...stop.position, km: PROVIDER_AGREES_KM } : undefined;
  const named = await resolveStationName(printedName, near);
  if (named.resolved) return named;
  if (stop.position) {
    return providerStation(
      printedName,
      { ...stop, position: stop.position },
      countryAt,
      conflictKm
    );
  }
  return { ...named, catalogueConflictKm: conflictKm };
}
