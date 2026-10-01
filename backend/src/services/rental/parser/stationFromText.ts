import { prisma } from "../../../db";

/**
 * Placing a station a mail names only in prose (spec
 * 2026-10-01-rental-domain-design §3.2, step 2): "<City> Flughafen",
 * "Aéroport de <City>". The words of the name — airport words removed — and
 * the document's own airport phrases are looked up among the catalogue's
 * open airports with an IATA code, narrowed by the country the mail names.
 *
 * Taken only when EXACTLY one airport answers. Two or more is a question for
 * the review, with every candidate listed (silent-failure class 1); none is
 * "unresolved", and the review asks for a station — the row is never written
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

export type StationResolution =
  | { status: "resolved"; airport: AirportHit }
  | { status: "ambiguous"; candidates: AirportHit[] }
  | { status: "unresolved" };

/** The place words of a station name: "Testhausen Nord Flughafen" → ["Testhausen", "Nord"]. */
export function placeWords(stationName: string): string[] {
  return stationName
    .replace(AIRPORT_WORDS, " ")
    .split(/[\s,/()-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

async function airportsNamed(word: string, country: string | null): Promise<AirportHit[]> {
  const contains = { contains: word, mode: "insensitive" as const };
  const rows = await prisma.airport.findMany({
    where: {
      isClosed: false,
      iata: { not: null },
      ...(country ? { country } : {}),
      OR: [{ city: contains }, { name: contains }, { municipalityName: contains }],
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
  if (sets.length === 0) return { status: "unresolved" };
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
