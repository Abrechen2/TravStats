import { prisma } from "../../../db";
import { searchPlacesDetailed } from "../../geo/photon";
import { airportSearchTerms } from "./airportCityAliases";

/**
 * Placing a station a mail names only in prose (spec
 * 2026-10-01-rental-domain-design §3.2, step 2): "<City> Flughafen",
 * "Aéroport de <City>". The words of the name — airport words removed — and
 * the document's own airport phrases are looked up among the catalogue's
 * open airports with an IATA code, narrowed by the country the mail names.
 *
 * Taken only when EXACTLY one airport answers. Two or more is a question for
 * the review, with every candidate listed (silent-failure class 1). A German
 * city name is also tried in the catalogue's English spelling
 * (`airportCityAliases.ts`). When no airport answers, the geocoder is asked
 * for the station name and its hit is OFFERED to the review as `geocoded`;
 * none is "unresolved", and a geocoder that could not be reached says so
 * (class 3) — the review asks for a station, and the row is never written
 * without one (class 2).
 */

const AIRPORT_WORDS =
  /\b(flughafen|airport|aéroport|aeroport|aeropuerto|aeroporto|luchthaven|lufthavn|international|intl|terminal|station|filiale|airportstation)\b/gi;

export interface AirportHit {
  airportId: number;
  iata: string;
  name: string;
  country: string | null;
}

/** A place the geocoder found for a station name no airport answered. */
export interface GeocodedPlace {
  label: string;
  lat: number;
  lon: number;
  country: string | null;
}

export type StationResolution =
  | { status: "resolved"; airport: AirportHit }
  | { status: "ambiguous"; candidates: AirportHit[] }
  | { status: "geocoded"; place: GeocodedPlace }
  | { status: "unresolved"; geocoderUnavailable?: true };

/** The place words of a station name: "Testhausen Nord Flughafen" → ["Testhausen", "Nord"]. */
export function placeWords(stationName: string): string[] {
  return stationName
    .replace(AIRPORT_WORDS, " ")
    .split(/[\s,/()-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

async function airportsNamed(word: string, country: string | null): Promise<AirportHit[]> {
  const or = airportSearchTerms(word).flatMap((term) => {
    const contains = { contains: term, mode: "insensitive" as const };
    return [{ city: contains }, { name: contains }, { municipalityName: contains }];
  });
  const rows = await prisma.airport.findMany({
    where: {
      isClosed: false,
      iata: { not: null },
      ...(country ? { country } : {}),
      OR: or,
    },
    select: { id: true, iata: true, name: true, country: true },
    take: 20,
  });
  return rows.map((r) => ({
    airportId: r.id,
    iata: r.iata as string,
    name: r.name,
    country: r.country,
  }));
}

/**
 * The airport a station name and the mail's hints point at. Words that find
 * airports are intersected ("Frankfurt Hahn" is Hahn, not both Frankfurt
 * airports); when they share none, every hit is a candidate for the review.
 */
export async function resolveStationFromText(
  stationName: string,
  hints: { country: string | null; airportWords: string[] }
): Promise<StationResolution> {
  const words = [...new Set([...placeWords(stationName), ...hints.airportWords])];
  const sets: AirportHit[][] = [];
  for (const word of words) {
    const hits = await airportsNamed(word, hints.country);
    if (hits.length > 0) sets.push(hits);
  }
  if (sets.length === 0) return geocodeStation(stationName, hints.country);
  const ids = (hits: AirportHit[]) => new Set(hits.map((h) => h.airportId));
  const shared = sets.reduce<Set<number>>(
    (acc, hits) => new Set([...acc].filter((id) => ids(hits).has(id))),
    ids(sets[0])
  );
  const all = new Map(sets.flat().map((h) => [h.airportId, h]));
  const chosen =
    shared.size > 0 ? [...shared].map((id) => all.get(id) as AirportHit) : [...all.values()];
  return chosen.length === 1
    ? { status: "resolved", airport: chosen[0] }
    : { status: "ambiguous", candidates: chosen };
}

/**
 * The fallback when no airport answers: the station name as an address. The
 * hit is a proposal the review shows, never a silent placement; outside the
 * country the mail names it is not taken at all.
 */
async function geocodeStation(
  stationName: string,
  country: string | null
): Promise<StationResolution> {
  const outcome = await searchPlacesDetailed(stationName, { limit: 1 });
  if (outcome.degraded) return { status: "unresolved", geocoderUnavailable: true };
  const hit = outcome.results[0];
  const hitCountry = hit?.countryCode?.toUpperCase() ?? null;
  if (!hit || (country && hitCountry && hitCountry !== country)) return { status: "unresolved" };
  return {
    status: "geocoded",
    place: {
      label: [hit.name, hit.city].filter(Boolean).join(", ") || stationName,
      lat: hit.lat,
      lon: hit.lon,
      country: hitCountry,
    },
  };
}
