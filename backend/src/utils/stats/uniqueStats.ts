import { getCachedAirports } from "../../services/airportCache";
import logger from "../logger";
import {
  continentsTouchedBy,
  countRoundTrips,
  crossesDateLine,
  changesEastWestHemisphere,
  crossesEquator,
  crossesLocalMidnight,
  flightAirportCodes,
  flightCountryReach,
  isArcticFlight,
  isOceanCrossing,
  isSameLocalDayFlight,
  isTimeTravelFlight,
  longitudeDirectionOf,
  touchesTropics,
} from "./flightPredicates";
import type { AirportData } from "../../services/airportLookup";
import type { FlightData, UniqueStats } from "./types";
import {
  fastestRouteOf,
  highestAirportOf,
  latitudeExtremeOf,
  layoverExtremesOf,
  longestTravelChainOf,
  mostCountriesInDayOf,
  seasonsReachedOf,
  type Layover,
} from "./uniqueExtremes";
import type { HomePeriod } from "../homeAirport";
import { isCountableFlight } from "../../shared/flightCounting";

/**
 * The flights behind each record-like tile (forgejo#256) — read by
 * `services/evidence/metricEvidenceFlightWitnesses.ts`, never by a client.
 */
export interface UniqueWitnesses {
  highestAirport: string[];
  northernmost: string[];
  southernmost: string[];
  longestTravelChain: string[];
  fastestRoute: string[];
  mostCountriesInDay: string[];
  seasons: string[];
  longestLayover: string[];
  shortestLayover: string[];
}

/**
 * Calculate unique/special statistics.
 *
 * Selective filtering — historical flights have unreliable times so we split
 * the input set:
 *   - `flownFlights`     : `flown` only with both times set. Used for
 *                          time-sensitive metrics: timeTravelIndex,
 *                          longestTravelChain, fastestRoute, mostCountriesInDay,
 *                          sameDayFlights, midnightFlights, longestLayover,
 *                          shortestLayover.
 *   - `countableFlights` : `flown` + `historical`. Used for everything that
 *                          is time-insensitive: equator/arctic/ocean
 *                          crossings, highest/northernmost/southernmost
 *                          airport, hemisphere hops, dateline crossings,
 *                          continents, tropics, east/west balance, seasons,
 *                          international/domestic, round-trip master.
 *
 * Note on seasons: month-of-departure is read from `departureTime`. For
 * historical flights with `DATE_ONLY` semantics the month is the user's
 * stated month; for `UNKNOWN`-year-only entries the schema stores 01-01,
 * which biases the season count toward winter. The expected volume of
 * such entries is tiny so we accept this approximation.
 */
export async function analyseUniqueStats(
  flights: FlightData[],
  homePeriods: readonly HomePeriod[] = []
): Promise<{ stats: UniqueStats; witnesses: UniqueWitnesses }> {
  // Time-sensitive subset — both times must be present.
  const flownFlights = flights.filter(
    (f): f is typeof f & { departureTime: Date; arrivalTime: Date } =>
      f.status === "flown" && f.departureTime !== null && f.arrivalTime !== null
  );

  // Time-insensitive subset — flown + historical contribute to geographic
  // coverage stats.
  const countableFlights = flights.filter(isCountableFlight);

  // Time travel index - flights where local arrival time (at destination) appears to be before
  // local departure time (at origin), e.g. departing NYC at 23:00 EST and arriving London at
  // 11:00 GMT — the clock "went back" by 5 hours so the local arrival hour is earlier.
  // Counted after the timezone map below exists, since it is read on it.

  // Collect all airport codes needed for timezone lookups; reused later for
  // altitude etc. Use the wider `countableFlights` set so altitude /
  // continent / country lookups also see historical airports.
  const airportCodes = flightAirportCodes(countableFlights);

  // Build a timezone map from the cached airport data (code → IANA timezone string)
  const timezoneMap = new Map<string, string>();
  let airportsForTimezone: Map<string, AirportData> = new Map();
  try {
    airportsForTimezone = await getCachedAirports(airportCodes);
    for (const [code, airport] of airportsForTimezone.entries()) {
      if (airport?.timezone) {
        timezoneMap.set(code, airport.timezone);
      }
    }
  } catch (error) {
    logger.error({
      operation: "calculate_unique_stats",
      message: "Failed to fetch airports for time-travel calculation",
      error,
    });
  }

  const timeTravelFlights = flownFlights.filter((f) => isTimeTravelFlight(f, timezoneMap)).length;

  // Equator crossings (north↔south) — geographic, time-insensitive.
  const equatorCrossings = countableFlights.filter(crossesEquator).length;

  // Arctic circle flights (north of 66.5°) — geographic, time-insensitive.
  const arcticFlights = countableFlights.filter(isArcticFlight).length;

  // Ocean crossings - simplified heuristic: flights over 5000km likely cross
  // an ocean. Distance-based, time-insensitive.
  const oceanCrossings = countableFlights.filter(isOceanCrossing).length;

  // The record-like tiles, each with the flights that decided it
  // (`uniqueExtremes.ts`, shared with their evidence resolver).
  let airports: Map<string, AirportData> = airportsForTimezone;
  if (airports.size === 0) {
    try {
      airports = await getCachedAirports(airportCodes);
    } catch (error) {
      logger.error({
        operation: "calculate_unique_stats",
        message: "Failed to fetch airports for altitude/country calculation",
        error,
      });
    }
  }
  const highest = highestAirportOf(countableFlights, airports);
  const north = latitudeExtremeOf(countableFlights, "north");
  const south = latitudeExtremeOf(countableFlights, "south");
  const chain = longestTravelChainOf(flownFlights);
  const fastest = fastestRouteOf(flownFlights, timezoneMap);
  // Grouped by the calendar day at the DEPARTURE airport, so a day that ends
  // after midnight UTC is still one day for the traveller.
  const busiestCountries = mostCountriesInDayOf(flownFlights, airports);

  // Hemisphere hopper — east↔west changes across the prime meridian or the
  // antimeridian (owner, 2026-09-25). Until then it repeated the equator
  // rule, so the two tiles always showed the same number.
  const hemisphereHops = countableFlights.filter(changesEastWestHemisphere).length;

  // Date line crosser — flights crossing the International Date Line (180°
  // longitude). Geographic, time-insensitive.
  const dateLineCrossings = countableFlights.filter(crossesDateLine).length;

  // Continental explorer — count unique continents. Time-insensitive.
  const continents = new Set<string>();
  try {
    const airports =
      airportsForTimezone.size > 0 ? airportsForTimezone : await getCachedAirports(airportCodes);
    countableFlights.forEach((f) => {
      for (const continent of continentsTouchedBy(f, airports)) continents.add(continent);
    });
  } catch (error) {
    logger.error({
      operation: "calculate_unique_stats",
      message: "Failed to fetch airports for continent calculation",
      error,
    });
  }

  // Tropics traveler — flights within the tropics (between 23.5°N and
  // 23.5°S). Geographic, time-insensitive.
  const tropicsFlights = countableFlights.filter(touchesTropics).length;

  // East-West balance — ratio of eastward vs westward flights. Geographic,
  // time-insensitive.
  const directions = countableFlights.map(longitudeDirectionOf);
  const eastwardFlights = directions.filter((d) => d === "east").length;
  const westwardFlights = directions.filter((d) => d === "west").length;

  // Same-day flights - flights that depart and arrive on the same local calendar day
  const sameDayFlights = flownFlights.filter((f) => isSameLocalDayFlight(f, timezoneMap)).length;

  // Midnight flyer - flights that cross midnight (local time)
  const midnightFlights = flownFlights.filter((f) => crossesLocalMidnight(f, timezoneMap)).length;

  // Seasonal explorer — flights in all 4 seasons. Month is reliable for
  // historical flights when the user knows it; a year-only entry's month
  // reads as January.
  const seasons = seasonsReachedOf(countableFlights);

  // International vs domestic — ratio based on countries. Time-insensitive.
  let internationalFlights = 0;
  let domesticFlights = 0;
  try {
    const airports =
      airportsForTimezone.size > 0 ? airportsForTimezone : await getCachedAirports(airportCodes);
    countableFlights.forEach((f) => {
      const reach = flightCountryReach(f, airports);
      if (reach === "domestic") domesticFlights++;
      else if (reach === "international") internationalFlights++;
    });
  } catch (error) {
    logger.error({
      operation: "calculate_unique_stats",
      message: "Failed to fetch airports for international/domestic calculation",
      error,
    });
  }

  // Layovers — capped, home airports excluded (`layoverExtremesOf`).
  const layovers = layoverExtremesOf(flownFlights, timezoneMap, homePeriods);

  // Round trip master — count complete round trips (A->B->A). Airport-pair
  // based, time-insensitive.
  // A round trip needs one leg in EACH direction, so a direction pair yields
  // as many round trips as its THINNER side — min(there, back).
  //
  // The previous count added up every leg that had any counterpart and halved
  // the sum: three A->B against one B->A gave (3+1)/2 = 2 round trips where
  // only one exists. Legs cannot be paired more often than the scarcer
  // direction allows.
  const roundTripCount = countRoundTrips(countableFlights).total;

  const stats: UniqueStats = {
    timeTravelIndex: timeTravelFlights,
    equatorCrossings,
    arcticFlights,
    oceanCrossings,
    highestAirport: highest
      ? { code: highest.code, name: highest.name, altitude: highest.altitude }
      : null,
    northernmost: north ? { lat: north.lat, code: north.code } : null,
    southernmost: south ? { lat: south.lat, code: south.code } : null,
    longestTravelChain: chain.length,
    fastestRoute: fastest ? { route: fastest.route, speed: fastest.speed } : null,
    mostCountriesInDay: busiestCountries.count,
    mostCountriesDate: busiestCountries.date,
    hemisphereHops,
    dateLineCrossings,
    continentalExplorer: continents.size,
    continents: Array.from(continents),
    tropicsTraveler: tropicsFlights,
    eastWestBalance: {
      eastward: eastwardFlights,
      westward: westwardFlights,
      ratio:
        westwardFlights > 0
          ? Math.round((eastwardFlights / westwardFlights) * 100) / 100
          : eastwardFlights,
    },
    sameDayFlights,
    midnightFlights,
    seasonalExplorer: seasons.seasons === 4,
    seasonsCount: seasons.seasons,
    internationalVsDomestic: {
      international: internationalFlights,
      domestic: domesticFlights,
      ratio:
        domesticFlights > 0
          ? Math.round((internationalFlights / domesticFlights) * 100) / 100
          : internationalFlights,
    },
    longestLayover: layoverOf(layovers.longest),
    shortestLayover: layoverOf(layovers.shortest),
    roundTripMaster: roundTripCount,
  };
  const witnesses: UniqueWitnesses = {
    highestAirport: highest?.flightIds ?? [],
    northernmost: north?.flightIds ?? [],
    southernmost: south?.flightIds ?? [],
    longestTravelChain: chain.flightIds,
    fastestRoute: fastest?.flightIds ?? [],
    mostCountriesInDay: busiestCountries.flightIds,
    seasons: seasons.flightIds,
    longestLayover: layovers.longest?.flightIds ?? [],
    shortestLayover: layovers.shortest?.flightIds ?? [],
  };
  return { stats, witnesses };
}

const layoverOf = (l: Layover | null): UniqueStats["longestLayover"] =>
  l ? { hours: l.hours, from: l.from, to: l.to } : null;

export async function calculateUniqueStats(
  flights: FlightData[],
  homePeriods: readonly HomePeriod[] = []
): Promise<UniqueStats> {
  return (await analyseUniqueStats(flights, homePeriods)).stats;
}

// toLocalDateString now lives in utils/timezone alongside localWallClockOf —
// had been copied here, and a second copy was about to be written for the
// year-scoped country index.
