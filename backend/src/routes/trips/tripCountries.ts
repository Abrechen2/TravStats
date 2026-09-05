import { prisma } from "../../db";
import { toCountryCode } from "../../shared/countryEvidence";

/**
 * Where a trip's countries come from — the stored list, or the flights,
 * cruises and stays linked to it.
 *
 * Split out of `routes/trips.ts` unchanged: that file is frozen at 1441 lines
 * in `scripts/file-size-baseline.json` and had grown past it, and these four
 * functions are the one group there that reads no request and writes no
 * response. Both the list and the detail endpoint call them — 2.5.0 fixed
 * only one of the two, which is the drift a shared module makes harder.
 */

/**
 * Airport facts (country + IANA zone) for a trip's flights, keyed by IATA.
 *
 * Two gaps share one lookup. The flight row stores UTC plus time semantics and
 * carries no zone of its own, so rendering each end in ITS airport's clock
 * needs the airport. And `trips.countries` is a stored column nobody derives,
 * while `flights.overflownCountries` is empty for manually created flights —
 * a hand-entered FRA-JFK left the trip reading "0 countries" for a route that
 * plainly spans two. The stored column still wins when the user filled it.
 */
export async function airportFactsFor(
  flights: Array<{ depIata: string | null; arrIata: string | null }>,
): Promise<Map<string, { country: string | null; timezone: string | null }>> {
  const codes = [
    ...new Set(
      flights
        .flatMap((f) => [f.depIata, f.arrIata])
        .filter((c): c is string => !!c),
    ),
  ];
  if (codes.length === 0) return new Map();
  const airports = await prisma.airport.findMany({
    where: { iata: { in: codes } },
    select: { iata: true, country: true, timezone: true },
  });
  return new Map(
    airports
      .filter((a): a is typeof a & { iata: string } => !!a.iata)
      .map((a) => [a.iata, { country: a.country, timezone: a.timezone }]),
  );
}

/**
 * Countries of a trip: the stored list when it has one, otherwise derived from
 * the countries its flights touch.
 *
 * `trips.countries` is a column nobody writes, and `overflownCountries` is
 * empty for manually created flights, so without the fallback the tile reads
 * zero for a trip that plainly visited five countries. 2.5.0 added that
 * fallback to GET /trips/:id only — and the LIST endpoint is what feeds the
 * trip cards, so every card on the Reisen overview kept showing "?" next to a
 * detail page showing five. Both call this now; a third caller must too.
 */
export function tripCountries(
  stored: string[],
  flights: Array<{ depIata: string | null; arrIata: string | null }>,
  facts: Map<string, { country: string | null; timezone: string | null }>,
  cruiseCountries: string[] = [],
  lodgingCountries: string[] = [],
): string[] {
  // A list the user filled in themselves is theirs — returned untouched.
  if (stored.length) return stored;

  const derived = [
    ...flights
      .flatMap((f) => [f.depIata, f.arrIata])
      .map((code) => (code ? facts.get(code)?.country : null))
      .filter((c): c is string => !!c),
    // Cruise-only trips carry no flights at all, so a flight-only derivation
    // left them reading "?" for a voyage that plainly called at six countries.
    // Their countries come from the ports they visited.
    ...cruiseCountries,
    // Same shape for hotel-only trips: a stay linked to the trip is itinerary
    // evidence even when no flight or cruise exists.
    ...lodgingCountries,
  ];

  // The two catalogues speak different languages — airports store ISO alpha-2,
  // ports store English names — so a trip with BOTH a flight and a cruise to
  // Germany would otherwise carry "DE" and "Germany" and count it twice. Fold
  // to one vocabulary, and keep anything unresolvable under its own name so a
  // country is never silently dropped from the list.
  return [...new Set(derived.map((c) => toCountryCode(c) ?? c))].sort();
}

/**
 * Countries reached by each trip's cruises, keyed by trip id.
 *
 * One query for every trip on the page rather than one per trip. Covers the
 * itinerary the way the cruise stats do: the port calls, plus the voyage's own
 * departure and arrival ports, which are not always repeated as stops.
 */
export async function cruiseCountriesByTrip(tripIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tripIds.length === 0) return out;

  const cruises = await prisma.cruise.findMany({
    where: { tripId: { in: tripIds }, status: { not: "cancelled" } },
    select: {
      tripId: true,
      departurePort: { select: { country: true } },
      arrivalPort: { select: { country: true } },
      stops: { select: { port: { select: { country: true } } } },
    },
  });

  for (const c of cruises) {
    if (!c.tripId) continue;
    const acc = out.get(c.tripId) ?? [];
    for (const country of [
      c.departurePort?.country,
      c.arrivalPort?.country,
      ...c.stops.map((s) => s.port?.country),
    ]) {
      if (country) acc.push(country);
    }
    out.set(c.tripId, acc);
  }
  return out;
}

/**
 * Countries reached by each trip's lodging stays, keyed by trip id.
 *
 * A linked stay is part of the trip itinerary just like a linked flight or
 * cruise. Use the lodging's ISO code when it exists, because the free-text
 * country field intentionally preserves the source wording.
 */
export async function lodgingCountriesByTrip(tripIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tripIds.length === 0) return out;

  const stays = await prisma.lodgingStay.findMany({
    // A cancelled booking never put anyone in that country. Planned stays do
    // count — a trip's itinerary is what it will visit, like its flights.
    where: { tripId: { in: tripIds }, status: { not: "cancelled" } },
    select: {
      tripId: true,
      lodging: { select: { isoCountryCode: true, country: true } },
    },
  });

  for (const stay of stays) {
    if (!stay.tripId) continue;
    const country = stay.lodging.isoCountryCode ?? stay.lodging.country;
    if (!country) continue;

    const acc = out.get(stay.tripId) ?? [];
    acc.push(country);
    out.set(stay.tripId, acc);
  }

  return out;
}
