import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";
import { loadHomeAirportHistory } from "../../services/stats/homeAirportHistory";
import { airportDisplayName } from "../../utils/airportDisplay";
import { getCurrentHomeAirport, getHomeAirportAt } from "../../utils/homeAirport";

/**
 * `GET /trips/entry-suggestions` — what the trip form can offer for its two
 * free-text place labels: where the user starts from (their current home
 * airport, named as a reader names it) and, for an existing trip, where it
 * went (the places its stays, cruises and flights point at, most frequent
 * first).
 *
 * Its own router file because `routes/trips.ts` is frozen in the file-size
 * baseline; mounted BEFORE that router, whose `GET /trips/:id` would read
 * "entry-suggestions" as a trip id. Authenticated per route, not per router:
 * it is mounted at `/api/v1/trips`, and a router-level guard would stand in
 * front of every trip route that passes through it.
 *
 * The stats rate-limit bucket, like `/flights/entry-suggestions`: several
 * reads per call, asked once when the form opens.
 */
const router = Router();

const DESTINATION_CAP = 4;
/** A trip is a handful of entries; the bound only stops a pathological one. */
const ENTRY_TAKE = 200;

export const tripEntrySuggestionsQuerySchema = z.object({
  tripId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().uuid().optional()
  ),
});

export interface TripEntrySuggestions {
  origins: string[];
  destinations: string[];
}

/** One place a trip's entry points at, in the order the trip reached it. */
export interface DestinationEvidence {
  city: string | null;
  /** Free-text country as the stay or port stores it; airports carry none here. */
  country?: string | null;
}

/**
 * The trip's destinations, most frequent first, then in the order the trip got
 * there. A country joins the list only when two or more of the named cities lie
 * in it — "Japan" for Tokyo + Kyoto is a destination, "Japan" for Tokyo alone
 * only repeats the city less precisely.
 */
export function rankDestinations(evidence: readonly DestinationEvidence[], cap: number): string[] {
  const cities = new Map<string, { label: string; count: number; first: number }>();
  const countries = new Map<string, { label: string; cities: Set<string>; first: number }>();
  evidence.forEach((e, index) => {
    const city = e.city?.trim();
    if (!city) return;
    const key = city.toLowerCase();
    const seen = cities.get(key);
    cities.set(
      key,
      seen ? { ...seen, count: seen.count + 1 } : { label: city, count: 1, first: index }
    );
    const country = e.country?.trim();
    if (!country) return;
    const countryKey = country.toLowerCase();
    const known = countries.get(countryKey);
    countries.set(countryKey, {
      label: known?.label ?? country,
      cities: new Set([...(known?.cities ?? []), key]),
      first: known?.first ?? index,
    });
  });

  const rankedCities = [...cities.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .map((c) => c.label);
  const spanningCountries = [...countries.values()]
    .filter((c) => c.cities.size >= 2)
    .sort((a, b) => b.cities.size - a.cities.size || a.first - b.first)
    .map((c) => c.label);
  return [...rankedCities, ...spanningCountries].slice(0, cap);
}

/**
 * Reader-facing names of airports by code; the catalogue's `city` is not one.
 * IATA or ICAO, because a home airport is stored as ICAO when it has no IATA.
 */
async function airportNames(codes: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.airport.findMany({
    where: { OR: [{ iata: { in: unique } }, { icao: { in: unique } }], isClosed: false },
    select: { iata: true, icao: true, name: true, municipalityName: true },
  });
  const names = new Map<string, string>();
  for (const row of rows) {
    const name = airportDisplayName(row);
    if (!name) continue;
    for (const code of [row.iata, row.icao]) {
      if (code && unique.includes(code) && !names.has(code)) names.set(code, name);
    }
  }
  return names;
}

function ymd(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

async function destinationsOf(
  userId: string,
  tripId: string,
  homeHistory: Awaited<ReturnType<typeof loadHomeAirportHistory>>
): Promise<string[]> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: {
      flights: {
        select: { depIata: true, arrIata: true, arrName: true, departureTime: true },
        orderBy: { departureTime: "asc" },
        take: ENTRY_TAKE,
      },
      cruises: {
        select: {
          startDate: true,
          arrivalPort: { select: { name: true, city: true, country: true } },
        },
        orderBy: { startDate: "asc" },
        take: ENTRY_TAKE,
      },
      lodgingStays: {
        select: { checkIn: true, lodging: { select: { city: true, country: true } } },
        orderBy: { checkIn: "asc" },
        take: ENTRY_TAKE,
      },
    },
  });
  if (!trip) throw new AppError("Trip not found", 404);

  // A flight home, or back to where the trip set out, arrives at the origin —
  // counting it would make every round trip's destination its own start.
  const start = trip.flights[0]?.depIata ?? null;
  const outbound = trip.flights.filter((f) => {
    if (!f.arrIata) return Boolean(f.arrName);
    const home = getHomeAirportAt(homeHistory, ymd(f.departureTime) ?? "");
    return f.arrIata !== start && f.arrIata !== home;
  });
  const names = await airportNames(
    outbound.map((f) => f.arrIata).filter((c): c is string => Boolean(c))
  );

  // Stays first: where the user slept is the strongest evidence of where the
  // trip went. A cruise names its end port, which is also where it docks home.
  return rankDestinations(
    [
      ...trip.lodgingStays.map((s) => ({ city: s.lodging.city, country: s.lodging.country })),
      ...trip.cruises.map((c) => ({
        city: c.arrivalPort ? (c.arrivalPort.city ?? c.arrivalPort.name) : null,
        country: c.arrivalPort?.country,
      })),
      ...outbound.map((f) => ({
        city: (f.arrIata && names.get(f.arrIata)) || airportDisplayName({ name: f.arrName }),
      })),
    ],
    DESTINATION_CAP
  );
}

router.get(
  "/entry-suggestions",
  authenticate,
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = tripEntrySuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const userId = req.userId!;
      const { tripId } = parsed.data;

      const homeHistory = await loadHomeAirportHistory(userId);
      const home = getCurrentHomeAirport(homeHistory);
      const [homeNames, destinations] = await Promise.all([
        home ? airportNames([home]) : Promise.resolve(new Map<string, string>()),
        tripId ? destinationsOf(userId, tripId, homeHistory) : Promise.resolve([]),
      ]);
      const homeName = home ? homeNames.get(home) : undefined;

      const body: TripEntrySuggestions = {
        origins: homeName ? [homeName] : [],
        destinations,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
