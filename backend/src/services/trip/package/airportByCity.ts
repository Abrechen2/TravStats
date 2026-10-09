/**
 * City name → IATA through the airport catalogue (plan P2 left this to P3:
 * it needs the catalogue, so it cannot be a pure transform).
 *
 * A travel itinerary writes "Munich - Bahrain", not "MUC - BAH". The answer is
 * ONE airport or none — never a guess. Three passes, each tried only when the
 * one before found nothing, over active airports that carry an IATA code:
 *
 *   1. the catalogue city equals the name ("Munich" → MUC; a parenthesised
 *      district is ignored, so "Hanoi (Soc Son)" is Hanoi)
 *   2. the airport's own name starts with the word ("Bahrain International
 *      Airport" → BAH, "Frankfurt Airport" → FRA — but not "Frankfurt-Hahn")
 *   3. the city starts with the word ("Frankfurt am Main")
 *
 * A pass that finds several airports ends the search as `ambiguous`, with the
 * candidates, so the review can offer them as choices: "Nairobi" is NBO and
 * WIL, and which one the operator meant is not in the text. The catalogue has
 * no scheduled-service flag (the OurAirports column is read at seeding and
 * dropped), so "prefer the airport with scheduled service" cannot be applied
 * here — it would need that column stored first.
 */
import { prisma } from "../../../db";

export interface AirportCandidate {
  iata: string;
  name: string;
  city: string | null;
}

export type CityResolution =
  | { kind: "resolved"; airport: AirportCandidate }
  | { kind: "ambiguous"; candidates: AirportCandidate[] }
  | { kind: "unknown" };

const MAX_CANDIDATES = 8;

function key(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctByIata(rows: AirportCandidate[]): AirportCandidate[] {
  const seen = new Map<string, AirportCandidate>();
  for (const row of rows) if (!seen.has(row.iata)) seen.set(row.iata, row);
  return [...seen.values()];
}

function decide(rows: AirportCandidate[]): CityResolution | null {
  const distinct = distinctByIata(rows);
  if (distinct.length === 0) return null;
  if (distinct.length === 1) return { kind: "resolved", airport: distinct[0] };
  return { kind: "ambiguous", candidates: distinct.slice(0, MAX_CANDIDATES) };
}

/** Resolves one place name. Pure lookups; nothing is written. */
export async function resolveCityToAirport(cityName: string): Promise<CityResolution> {
  const wanted = key(cityName);
  if (wanted.length < 2) return { kind: "unknown" };
  const word = wanted.split(" ")[0];
  const rows = await prisma.airport.findMany({
    where: {
      isClosed: false,
      iata: { not: null },
      OR: [
        { city: { startsWith: word, mode: "insensitive" } },
        { name: { startsWith: word, mode: "insensitive" } },
      ],
    },
    select: { iata: true, name: true, city: true },
    take: 200,
  });
  const airports = rows.flatMap((r) =>
    r.iata && /^[A-Z]{3}$/.test(r.iata) ? [{ iata: r.iata, name: r.name, city: r.city }] : []
  );

  const passes: Array<(a: AirportCandidate) => boolean> = [
    (a) => a.city !== null && key(a.city) === wanted,
    (a) => key(a.name).startsWith(`${wanted} `),
    (a) => a.city !== null && key(a.city).startsWith(`${wanted} `),
  ];
  for (const pass of passes) {
    const decided = decide(airports.filter(pass));
    if (decided) return decided;
  }
  return { kind: "unknown" };
}

/** Resolves every distinct name once. Keys are the names as written. */
export async function resolveCities(names: Iterable<string>): Promise<Map<string, CityResolution>> {
  const out = new Map<string, CityResolution>();
  for (const name of new Set(names)) out.set(name, await resolveCityToAirport(name));
  return out;
}

/** The catalogue row for a chosen IATA, or null when the catalogue has no such active airport. */
export async function airportByIata(iata: string): Promise<AirportCandidate | null> {
  const row = await prisma.airport.findFirst({
    where: { iata: iata.toUpperCase(), isClosed: false },
    select: { iata: true, name: true, city: true },
  });
  return row?.iata ? { iata: row.iata, name: row.name, city: row.city } : null;
}
