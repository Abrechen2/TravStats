import { prisma } from "../db";
import type { CountryTimelineEntry } from "../schemas/statsCountryDetail";
import { loadGroundTimelines } from "../services/evidence/metricEvidencePassport";
import { FLOWN } from "../services/stats/flightEvidence";
import type { PassportSources } from "../services/stats/passportLoader";
import type { PassportCountry } from "../services/stats/passport";
import {
  continentForCoordinates,
  continentForCountry,
  isTranscontinental,
  isoCountryCode,
} from "./continents";

type Point = { lat: number | null; lon: number | null };

/**
 * The continents the user set foot on, for the continent badges (forgejo#299).
 *
 * Three sources, each a piece of GROUND evidence — never a location point:
 *
 * 1. A ground-contact passport row of a one-continent country: its continent
 *    follows from the country alone.
 * 2. A row of a transcontinental country (RU, KZ, TR, EG): a row carries ONE
 *    continent, filed from its first record, so Vladivostok after Moscow lost
 *    Asia and a stay in Sinai filed nowhere. Each of the country's records is
 *    placed by its own coordinates through `continentForCountry`, which
 *    returns null rather than guessing. Only a row no record can place falls
 *    back to its own continent (a manual override has no record).
 * 3. A flown airport whose country the catalogue does not know: it proves no
 *    country — the passport leaves it out — but the airport's coordinates
 *    still prove the continent, as the airport-by-airport rule did.
 */
export async function groundContinents(
  userId: string,
  rows: readonly PassportCountry[],
  sources: PassportSources
): Promise<Set<string>> {
  const continents = new Set<string>();
  const split: PassportCountry[] = [];
  for (const row of rows) {
    if (!row.groundPresence) continue;
    if (isTranscontinental(row.code)) split.push(row);
    else if (row.continent) continents.add(row.continent);
  }

  const [placed, unplaced] = await Promise.all([
    transcontinentalContinents(userId, sources, split),
    unplacedAirportContinents(userId),
  ]);
  for (const row of split) {
    const here = placed.get(row.code);
    if (here && here.size > 0) here.forEach((c) => continents.add(c));
    else if (row.continent) continents.add(row.continent);
  }
  unplaced.forEach((c) => continents.add(c));
  return continents;
}

/** Each transcontinental country's continents, one per record that has coordinates. */
async function transcontinentalContinents(
  userId: string,
  sources: PassportSources,
  rows: readonly PassportCountry[]
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (rows.length === 0) return out;
  const timelines = await loadGroundTimelines(
    userId,
    sources,
    rows.map((r) => r.code)
  );
  for (const [code, { airports, rows: timeline }] of timelines) {
    out.set(code, await continentsOfRecords(userId, code, airports, timeline));
  }
  return out;
}

/**
 * The continents some records of ONE transcontinental country stood on, each
 * placed by its own coordinates; a record without coordinates places nothing.
 * The badge's evidence asks it per record, so a row credits only what it proves.
 */
export async function continentsOfRecords(
  userId: string,
  code: string,
  airports: readonly string[],
  rows: readonly CountryTimelineEntry[]
): Promise<Set<string>> {
  const here = new Set<string>();
  for (const p of await pointsOf(userId, code, airports, rows)) {
    if (p.lat === null || p.lon === null) continue;
    const continent = continentForCountry(code, p.lat, p.lon);
    if (continent) here.add(continent);
  }
  return here;
}

const idsOf = <K extends CountryTimelineEntry["kind"]>(
  rows: readonly CountryTimelineEntry[],
  kind: K,
  pick: (row: Extract<CountryTimelineEntry, { kind: K }>) => string
): string[] => [
  ...new Set(
    rows.flatMap((r) =>
      r.kind === kind ? [pick(r as Extract<CountryTimelineEntry, { kind: K }>)] : []
    )
  ),
];

/** Where each record of one country stood: airports, ports, houses, places, stations. */
async function pointsOf(
  userId: string,
  code: string,
  airports: readonly string[],
  rows: readonly CountryTimelineEntry[]
): Promise<Point[]> {
  const inCountry = (country: string | null | undefined) => isoCountryCode(country) === code;
  const placeIds = idsOf(rows, "place", (r) => r.placeId);
  const lodgingIds = idsOf(rows, "lodging", (r) => r.lodgingId);
  const cruiseIds = idsOf(rows, "port", (r) => r.cruiseId);
  const stationIds = idsOf(rows, "roadtrip", (r) => r.stationId);
  const railIds = idsOf(rows, "rail", (r) => r.rideId);
  const busIds = idsOf(rows, "bus", (r) => r.rideId);
  const ferryIds = idsOf(rows, "ferry", (r) => r.rideId);
  const ends = { depLat: true, depLon: true, depCountry: true, arrLat: true, arrLon: true, arrCountry: true } as const; // prettier-ignore
  const none = Promise.resolve([]);

  const [airportRows, places, lodgings, stops, stations, rail, bus, ferry] = await Promise.all([
    airports.length ? prisma.airport.findMany({ where: { iata: { in: [...airports] }, isClosed: false }, select: { lat: true, lon: true } }) : none, // prettier-ignore
    placeIds.length ? prisma.place.findMany({ where: { userId, id: { in: placeIds } }, select: { lat: true, lon: true } }) : none, // prettier-ignore
    lodgingIds.length ? prisma.lodging.findMany({ where: { userId, id: { in: lodgingIds } }, select: { lat: true, lon: true } }) : none, // prettier-ignore
    cruiseIds.length ? prisma.cruiseStop.findMany({ where: { cruiseId: { in: cruiseIds }, cruise: { userId } }, select: { port: { select: { lat: true, lon: true, country: true } } } }) : none, // prettier-ignore
    stationIds.length ? prisma.tripStop.findMany({ where: { id: { in: stationIds } }, select: { lat: true, lon: true } }) : none, // prettier-ignore
    railIds.length ? prisma.railJourney.findMany({ where: { userId, id: { in: railIds } }, select: ends }) : none, // prettier-ignore
    busIds.length ? prisma.busJourney.findMany({ where: { userId, id: { in: busIds } }, select: ends }) : none, // prettier-ignore
    ferryIds.length ? prisma.ferryJourney.findMany({ where: { userId, id: { in: ferryIds } }, select: ends }) : none, // prettier-ignore
  ]);

  // A ride or a cruise also has ends and ports in other countries; only the
  // ones in THIS country are its evidence here.
  const rideEnds = [...rail, ...bus, ...ferry].flatMap((r) => [
    ...(inCountry(r.depCountry) ? [{ lat: r.depLat, lon: r.depLon }] : []),
    ...(inCountry(r.arrCountry) ? [{ lat: r.arrLat, lon: r.arrLon }] : []),
  ]);
  const ports = stops.flatMap((s) => (s.port && inCountry(s.port.country) ? [s.port] : []));
  return [...airportRows, ...places, ...lodgings, ...ports, ...stations, ...rideEnds];
}

/**
 * Continents of flown airports whose catalogue country is unknown, by the
 * airport's coordinates. Such an airport is in no passport row, so it is read
 * here from the same flights the passport stamps (`FLOWN`).
 */
async function unplacedAirportContinents(userId: string): Promise<Set<string>> {
  const flights = await prisma.flight.findMany({
    where: { userId, status: { in: [...FLOWN] } },
    select: { depIata: true, arrIata: true },
  });
  const codes = [
    ...new Set(flights.flatMap((f) => [f.depIata, f.arrIata]).filter((c): c is string => !!c)),
  ].map((c) => c.toUpperCase());
  if (codes.length === 0) return new Set();
  const airports = await prisma.airport.findMany({
    where: { iata: { in: codes }, isClosed: false },
    select: { country: true, lat: true, lon: true },
  });
  const out = new Set<string>();
  for (const a of airports) {
    if (isoCountryCode(a.country)) continue;
    const continent = continentForCoordinates(a.lat, a.lon);
    if (continent) out.add(continent);
  }
  return out;
}
