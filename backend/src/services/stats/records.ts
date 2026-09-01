import { haversineKm } from "../../shared/geo/haversine";

/**
 * Travel records, derived once here — Forgejo #41, and the principle behind
 * #42: every counting rule belongs to the server.
 *
 * The Companion already computes these seven in
 * `app/src/lib/server/records-adapters.ts`, and that module is the reference
 * this one is ported from rather than reinvented. Its edge cases were decided
 * against real data and are preserved verbatim below; getting one of them
 * subtly different here would produce exactly the drift #42 was filed about —
 * two answers to "what was my longest flight" from one account.
 *
 * ## What this deliberately does NOT do
 *
 * It returns numbers, not sentences. The Companion's adapter emits
 * `"12.345 km"` and `"12 h 40 min"` because it is a view; an endpoint that did
 * the same would fix the decimal separator, the unit and the word order for
 * every client that ever reads it. A German comma in a JSON payload is a bug
 * waiting for an English reader. Each record therefore carries a `value`, a
 * `unit` and the raw parts of its detail, and every client formats in its own
 * locale — the same reasoning that made ranks and categories slugs rather than
 * translated strings.
 *
 * ## Abstention is a result
 *
 * A record that cannot be derived is OMITTED, never zero and never invented.
 * "No delay recorded" and "on time" are different facts, and a shortest flight
 * of 0 km would win forever.
 */

const FLOWN = new Set(["flown", "historical"]);

export interface RecordFlightInput {
  id: string;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  departureTime: Date | null;
  durationMinutes: number | null;
  delayMinutes: number | null;
  routeDistance: number | null;
  status: string;
}

export type RecordId =
  | "longest-flight"
  | "shortest-flight"
  | "busiest-day"
  | "longest-aloft"
  | "biggest-delay"
  | "northernmost"
  | "longest-streak";

export type RecordUnit = "km" | "minutes" | "flights" | "days" | "degrees-north";

export interface TravelRecord {
  id: RecordId;
  value: number;
  unit: RecordUnit;
  /** The flight this record is about, when it is about one. */
  flightId?: string;
  /** The airport it is about, when the record names a place rather than a leg. */
  airportIata?: string;
  /** Raw parts a client may render; never pre-composed prose. */
  depIata?: string | null;
  arrIata?: string | null;
  flightNumber?: string | null;
  durationMinutes?: number | null;
  /** "YYYY-MM-DD" — a single day, or the ends of a stretch. */
  date?: string;
  startDate?: string;
  endDate?: string;
  /** Legs flown on the busiest day, in departure order. */
  legs?: string[];
}

/**
 * Stored distance first, great-circle second, nothing third.
 *
 * Most real rows carry no stored `routeDistance`, and judging only over the few
 * that do misses the actual longest leg — the Companion found that against a
 * real account. A row with neither a distance nor two endpoints abstains.
 */
function distanceKm(flight: RecordFlightInput): number | null {
  if (typeof flight.routeDistance === "number" && flight.routeDistance > 0) {
    return flight.routeDistance;
  }
  const { depLat, depLon, arrLat, arrLon } = flight;
  if (
    typeof depLat === "number" &&
    typeof depLon === "number" &&
    typeof arrLat === "number" &&
    typeof arrLon === "number"
  ) {
    return haversineKm({ lat: depLat, lon: depLon }, { lat: arrLat, lon: arrLon });
  }
  return null;
}

/** Calendar day of the stored departure instant, as stored — no zone math. */
function dayOf(flight: RecordFlightInput): string | null {
  return flight.departureTime ? flight.departureTime.toISOString().slice(0, 10) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayMillis = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

function longestFlight(flights: readonly RecordFlightInput[]): TravelRecord | null {
  let best: { flight: RecordFlightInput; distance: number } | null = null;
  for (const flight of flights) {
    const distance = distanceKm(flight);
    if (distance === null) continue;
    // `>=` on the tie so the most RECENT of equal legs wins — the Companion's
    // rule, kept so both sides name the same flight.
    const ties =
      best !== null &&
      distance === best.distance &&
      (flight.departureTime?.toISOString() ?? "") >=
        (best.flight.departureTime?.toISOString() ?? "");
    if (best === null || distance > best.distance || ties) best = { flight, distance };
  }
  if (!best) return null;
  return {
    id: "longest-flight",
    value: Math.round(best.distance),
    unit: "km",
    flightId: best.flight.id,
    depIata: best.flight.depIata,
    arrIata: best.flight.arrIata,
    durationMinutes: best.flight.durationMinutes,
  };
}

function shortestFlight(flights: readonly RecordFlightInput[]): TravelRecord | null {
  let best: { flight: RecordFlightInput; distance: number } | null = null;
  for (const flight of flights) {
    const distance = distanceKm(flight);
    // `<= 0` excluded: a zero-length leg would win this record forever.
    if (distance === null || distance <= 0) continue;
    if (best === null || distance < best.distance) best = { flight, distance };
  }
  if (!best) return null;
  return {
    id: "shortest-flight",
    value: Math.round(best.distance),
    unit: "km",
    flightId: best.flight.id,
    depIata: best.flight.depIata,
    arrIata: best.flight.arrIata,
  };
}

function busiestDay(byDay: ReadonlyMap<string, RecordFlightInput[]>): TravelRecord | null {
  let bestDay: string | null = null;
  for (const [day, legs] of byDay) {
    const bestLegs = bestDay === null ? null : (byDay.get(bestDay) as RecordFlightInput[]);
    if (
      bestLegs === null ||
      legs.length > bestLegs.length ||
      (legs.length === bestLegs.length && day >= (bestDay as string))
    ) {
      bestDay = day;
    }
  }
  if (bestDay === null) return null;
  const legs = [...(byDay.get(bestDay) as RecordFlightInput[])].sort((a, b) =>
    (a.departureTime?.toISOString() ?? "").localeCompare(b.departureTime?.toISOString() ?? "")
  );
  return {
    id: "busiest-day",
    value: legs.length,
    unit: "flights",
    date: bestDay,
    // The chain of airports, dep of the first then every arrival. Assembled
    // here because it IS the record's content; the wording around it is not.
    legs: [legs[0].depIata ?? "", ...legs.map((l) => l.arrIata ?? "")],
  };
}

function longestAloft(flights: readonly RecordFlightInput[]): TravelRecord | null {
  let best: { flight: RecordFlightInput; minutes: number } | null = null;
  for (const flight of flights) {
    const minutes = flight.durationMinutes;
    // A placeholder row stored as T00:00 has no real duration; it abstains
    // rather than reporting a flight that took no time.
    if (typeof minutes !== "number" || minutes <= 0) continue;
    if (best === null || minutes > best.minutes) best = { flight, minutes };
  }
  if (!best) return null;
  return {
    id: "longest-aloft",
    value: best.minutes,
    unit: "minutes",
    flightId: best.flight.id,
    depIata: best.flight.depIata,
    arrIata: best.flight.arrIata,
  };
}

function biggestDelay(flights: readonly RecordFlightInput[]): TravelRecord | null {
  let best: { flight: RecordFlightInput; minutes: number } | null = null;
  for (const flight of flights) {
    const minutes = flight.delayMinutes;
    // Positive only. An early arrival is not a delay record, and a row without
    // the field abstains rather than counting as punctual — "no delay recorded"
    // and "on time" are different facts.
    if (typeof minutes !== "number" || minutes <= 0) continue;
    if (best === null || minutes > best.minutes) best = { flight, minutes };
  }
  if (!best) return null;
  return {
    id: "biggest-delay",
    value: best.minutes,
    unit: "minutes",
    flightId: best.flight.id,
    flightNumber: best.flight.flightNumber,
    depIata: best.flight.depIata,
    arrIata: best.flight.arrIata,
  };
}

function northernmost(flights: readonly RecordFlightInput[]): TravelRecord | null {
  let best: { lat: number; iata: string | null } | null = null;
  const consider = (lat: number | null, iata: string | null): void => {
    // Coordinates only: an IATA code is not a position, and a row the server
    // never geocoded has no latitude to compare.
    if (typeof lat !== "number" || !Number.isFinite(lat)) return;
    if (best === null || lat > best.lat) best = { lat, iata };
  };
  for (const flight of flights) {
    consider(flight.depLat, flight.depIata);
    consider(flight.arrLat, flight.arrIata);
  }
  if (best === null) return null;
  const found = best as { lat: number; iata: string | null };
  return {
    id: "northernmost",
    // Unrounded on purpose: the client decides how many decimals a latitude
    // deserves, and rounding here would throw the choice away.
    value: found.lat,
    unit: "degrees-north",
    // An airport, not a flight — several legs may have touched this point and
    // the record names none of them.
    ...(found.iata ? { airportIata: found.iata } : {}),
  };
}

function longestStreak(days: readonly string[]): TravelRecord | null {
  if (days.length === 0) return null;
  let best = { start: days[0], end: days[0], length: 1 };
  let start = days[0];
  let length = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (dayMillis(days[i]) - dayMillis(days[i - 1]) === DAY_MS) {
      length += 1;
    } else {
      // `>=` lets the most recent of equally long streaks win.
      if (length >= best.length) best = { start, end: days[i - 1], length };
      start = days[i];
      length = 1;
    }
  }
  if (length >= best.length) best = { start, end: days[days.length - 1], length };
  return {
    id: "longest-streak",
    value: best.length,
    unit: "days",
    startDate: best.start,
    endDate: best.end,
  };
}

/**
 * The seven records, in the order the Companion's screen draws them: the first
 * is the headline, the rest are tiles. Underivable rows are dropped, so a young
 * account gets a short list rather than a grid of dashes.
 */
export function buildTravelRecords(flights: readonly RecordFlightInput[]): TravelRecord[] {
  const counted = flights.filter((f) => FLOWN.has(f.status));

  const byDay = new Map<string, RecordFlightInput[]>();
  for (const flight of counted) {
    const day = dayOf(flight);
    if (day === null) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), flight]);
  }
  const days = [...byDay.keys()].sort();

  return [
    longestFlight(counted),
    shortestFlight(counted),
    busiestDay(byDay),
    longestAloft(counted),
    biggestDelay(counted),
    northernmost(counted),
    longestStreak(days),
  ].filter((r): r is TravelRecord => r !== null);
}
