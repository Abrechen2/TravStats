/**
 * Everything the passport needs from the database, read once.
 *
 * `buildPassport` is a pure function so it can be unit-tested against
 * hand-written rows; this is the file that goes and gets those rows. The split
 * is deliberate and predates this module — it just used to live inside
 * `routes/stats.ts`, which is how a route file grew past its size limit while
 * holding the country rules the design put in `services/stats/`.
 *
 * Nothing here decides anything. Which stay proves a country, which tier a
 * ground segment gets, whether a house with no stay counts — all of that is
 * `shared/countryEvidence.ts` and `services/stats/passport.ts`. This file only
 * chooses WHICH rows to hand them, and the one judgement in that choice
 * (`visited: false` is a bookmark, not a visit) is named where it is made.
 */

import { prisma } from "../../db";
import { getCachedAirports } from "../airportCache";
import { countableFlightWhere } from "../../shared/flightCounting";
import { normalizeHistory } from "../../utils/homeAirport";
import {
  localWallClockOf,
  normalizeFlightTimeUtc,
  type FlightTimeSemantics,
} from "../../utils/timezone";
import type { SettingsDataJson } from "../../routes/settings/types";
import { countryThresholdFor } from "../countryThresholdResolver";
import { buildTzMap, withDepartureClock } from "./departureClock";
import { buildPassport } from "./passport";

/**
 * The airport codes a passport-shaped flight row touches, deduplicated.
 *
 * IATA only, deliberately: `buildPassport` keys its airports by that code and
 * an ICAO fallback would file the same airport twice under two names.
 */
export function passportAirportCodes(
  flights: readonly { depIata: string | null; arrIata: string | null }[]
): string[] {
  return [
    ...new Set(
      flights.flatMap((f) => [f.depIata, f.arrIata]).filter((c): c is string => Boolean(c))
    ),
  ];
}

/**
 * A stored flight time as a REAL instant, or null when the row holds none.
 *
 * `normalizeFlightTimeUtc` answers the timezone half; the DATE_ONLY cut is
 * added here for the same reason `tzAwareDurationMinutes` makes it — those rows
 * carry a 12:00 placeholder, and a placeholder minus a placeholder is a
 * plausible-looking ground time that nobody measured. `Abstention is a result`:
 * the country then reports `unknown`, which is what it is.
 */
function realInstant(
  stored: Date | null,
  semantics: FlightTimeSemantics,
  airportTz: string | null
): Date | null {
  if (semantics === "DATE_ONLY") return null;
  return normalizeFlightTimeUtc(stored, semantics, airportTz);
}

/** Country per airport code, as the catalogue holds it. */
export async function loadAirportCountries(codes: string[]): Promise<Map<string, string | null>> {
  // One catalogue lookup for every end of every flight. A failure here costs
  // the countries, so it is reported rather than swallowed into an empty
  // passport that looks like someone who has never flown.
  const airports = codes.length > 0 ? await getCachedAirports(codes) : new Map();
  return new Map<string, string | null>(
    [...airports.entries()].map(([code, data]) => [code, data?.country ?? null])
  );
}

/** The user's home airport codes, newest history first. */
export async function loadHomeIatas(userId: string): Promise<string[]> {
  const homeSettings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const historyData =
    homeSettings?.data && typeof homeSettings.data === "object"
      ? (homeSettings.data as SettingsDataJson).homeAirportHistory
      : undefined;
  return normalizeHistory(historyData).map((entry) => entry.iata);
}

/**
 * Build the whole passport for a user.
 *
 * Shared with `/stats/wrapped` so its "new countries this year" comes from the
 * same object `/stats/passport` publishes. Deriving that number a second time
 * from the flight list would make the story disagree with the passport on an
 * account with a cruise — which is precisely the drift #42 is about.
 */
export async function loadPassport(userId: string): Promise<ReturnType<typeof buildPassport>> {
  const flights = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      depIata: true,
      depIcao: true,
      depLat: true,
      depLon: true,
      arrIata: true,
      arrIcao: true,
      arrLat: true,
      arrLon: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
      status: true,
    },
  });

  /**
   * The calendar day each flight belongs to, at the DEPARTURE airport's clock.
   *
   * The tiers ask whether a night passed between landing somewhere and taking
   * off again, and that question only has an answer on a local clock: a 23:30
   * arrival in Tokyo is already the next UTC day, so a UTC comparison would
   * report an overnight for a two-hour connection. `withDepartureClock` is the
   * same resolution every other "when did I fly" figure on this server goes
   * through — deriving the timezone a second time here is exactly the drift
   * #42 is about. The ICAO columns are selected only to feed it.
   */
  /**
   * The ARRIVAL clock as well, which `withDepartureClock` deliberately does not
   * carry. A ground time is landing-here to taking-off-again, so it needs both
   * ends resolved to real instants (spec §3.4b), which is what `realInstant`
   * above does.
   *
   * A second `buildTzMap` pass rather than a rewrite of `withDepartureClock`:
   * both read the same `getCachedAirports` cache, and widening that helper would
   * touch every "when did I fly" figure on the server for one new column here.
   */
  const [dated, tzMap] = await Promise.all([withDepartureClock(flights), buildTzMap(flights)]);
  const zoneOf = (iata: string | null, icao: string | null): string | null =>
    (iata ? tzMap.get(iata) : undefined) ?? (icao ? tzMap.get(icao) : undefined) ?? null;

  const passportFlights = dated.map((f) => ({
    ...f,
    localDay: f.departureTime
      ? localWallClockOf(f.departureTime, f.depTimezone, f.depTimeSemantics).date
      : null,
    departureInstant: realInstant(f.departureTime, f.depTimeSemantics, f.depTimezone),
    arrivalInstant: realInstant(
      f.arrivalTime,
      f.arrTimeSemantics as FlightTimeSemantics,
      zoneOf(f.arrIata, f.arrIcao)
    ),
  }));

  /**
   * Evidence beyond landings — Forgejo #42, owner's decision 2026-08-31.
   *
   * A cruise that CALLED at a port and a place the user recorded visiting both
   * prove presence. Only sailed cruises count, the same cut rule 1 makes for
   * flights, and a place joins on its resolved `isoCountryCode` because
   * "Deutschland" and "Germany" are one country and only the code knows that.
   */
  // prettier-ignore
  const [airportCountries, portCalls, placeVisits, lodgings, homeIatas, threshold] = await Promise.all([
    loadAirportCountries(passportAirportCodes(flights)),
    prisma.cruiseStop.findMany({
      where: {
        cruise: { userId, status: { in: ["flown", "historical"] } },
        port: { isNot: null },
      },
      select: {
        arrivalTime: true,
        departureTime: true,
        date: true,
        port: { select: { country: true } },
      },
    }),
    prisma.place.findMany({
      where: { userId, visited: true, isoCountryCode: { not: null } },
      select: { isoCountryCode: true, visits: { select: { visitedAt: true } } },
    }),
    /**
     * Lodging as evidence — spec §1.2, the clearest of the four bugs. A country
     * reached by car and slept in for a week did not appear in this passport at
     * all, while a four-hour port call did.
     *
     * `visited: false` is excluded because that is a house the user only noted
     * down, not one they went to — the same cut `shared/lodgingCounting.ts`
     * makes, and the reason a saved-places import does not silently become a
     * list of countries. The join is on `isoCountryCode`; the free-text
     * `country` column beside it holds "Deutschland", "Germany" and
     * "Schweiz/Suisse/Svizzera/Svizra" in one account and would double-count.
     *
     * The stays arrive unfiltered and WITH their status: which of them proves
     * anything is `lodgingEvidence`'s decision, and filtering here would leave a
     * house with NO stay — which counts, so a cancellation would prove a country.
     */
    prisma.lodging.findMany({
      where: { userId, visited: true, isoCountryCode: { not: null } },
      select: {
        isoCountryCode: true,
        stays: { select: { status: true, checkIn: true, checkOut: true } },
      },
    }),
    loadHomeIatas(userId),
    /**
     * Which tier the headline counts from — the user's own choice, else the
     * instance default (spec §3.2). Read HERE rather than inside
     * `buildPassport` so that function stays pure and testable against
     * hand-written rows, which is the split this whole file exists for.
     *
     * It changes the headline and nothing else: every country below is loaded,
     * folded and returned at every threshold.
     */
    countryThresholdFor(userId),
  ]);

  return buildPassport(
    passportFlights,
    airportCountries,
    homeIatas,
    new Date(),
    portCalls.map((stop) => ({
      country: stop.port?.country ?? null,
      at: stop.arrivalTime ?? stop.date,
      // Only ever used to tell an overnight call from a day in port. A stop
      // with no departure time stays `visited`, which is what it can prove.
      until: stop.departureTime,
    })),
    // A place's visits, flattened: each dated visit is its own evidence, and a
    // place with none still proves the country through `visited`.
    placeVisits.flatMap((place) =>
      place.visits.length > 0
        ? place.visits.map((v) => ({ isoCountryCode: place.isoCountryCode, at: v.visitedAt }))
        : [{ isoCountryCode: place.isoCountryCode, at: null }]
    ),
    lodgings,
    threshold
  );
}
