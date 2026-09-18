import { calculateDistance } from "../geo";
import { getCachedAirports } from "../../services/airportCache";
import { tzAwareDurationMinutes, type FlightTimeSemantics } from "../timezone";
import logger from "../logger";
import { departureClockOf } from "./departureClock";
import {
  arrivalEndpointCode,
  continentsTouchedBy,
  countRoundTrips,
  crossesDateLine,
  crossesHemisphere,
  crossesLocalMidnight,
  departureEndpointCode,
  departureTimezoneOf,
  arrivalTimezoneOf,
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
import { HomeAirportEntry, getHomeAirportAt } from "../homeAirport";
import { isCountableFlight } from "../../shared/flightCounting";

/** Max duration counted as a "layover". Anything longer is a stopover / trip gap. */
const LAYOVER_CAP_HOURS = 24;

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
export async function calculateUniqueStats(
  flights: FlightData[],
  homeAirportHistory: HomeAirportEntry[] = []
): Promise<UniqueStats> {
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

  // Equator crossings — geographic, time-insensitive. Note that this is the
  // same rule as the hemisphere hop below, and always has been; see
  // `flightPredicates.ts` on why one predicate now serves both tiles.
  const equatorCrossings = countableFlights.filter(crossesHemisphere).length;

  // Arctic circle flights (north of 66.5°) — geographic, time-insensitive.
  const arcticFlights = countableFlights.filter(isArcticFlight).length;

  // Ocean crossings - simplified heuristic: flights over 5000km likely cross
  // an ocean. Distance-based, time-insensitive.
  const oceanCrossings = countableFlights.filter(isOceanCrossing).length;

  // Highest airport (altitude) — reuse the airport data already fetched for timezone lookups
  let highestAirport: { code: string; name: string; altitude: number } | null = null;

  try {
    // If the timezone fetch above failed, do a fresh fetch; otherwise reuse cached data
    const airportsForAltitude =
      airportsForTimezone.size > 0 ? airportsForTimezone : await getCachedAirports(airportCodes);
    for (const [code, airport] of airportsForAltitude.entries()) {
      if (airport && airport.altitude != null) {
        if (!highestAirport || airport.altitude > highestAirport.altitude) {
          highestAirport = {
            code: code,
            name: airport.name || code,
            altitude: airport.altitude,
          };
        }
      }
    }
  } catch (error) {
    logger.error({
      operation: "calculate_unique_stats",
      message: "Failed to fetch airports for altitude calculation",
      error,
    });
  }

  // Northernmost and southernmost points — geographic, time-insensitive.
  let northernmost: { lat: number; code: string } | null = null;
  let southernmost: { lat: number; code: string } | null = null;

  countableFlights.forEach((f) => {
    if (f.depLat != null) {
      if (!northernmost || f.depLat > northernmost.lat) {
        northernmost = { lat: f.depLat, code: f.depIata || f.depIcao || "?" };
      }
      if (!southernmost || f.depLat < southernmost.lat) {
        southernmost = { lat: f.depLat, code: f.depIata || f.depIcao || "?" };
      }
    }
    if (f.arrLat != null) {
      if (!northernmost || f.arrLat > northernmost.lat) {
        northernmost = { lat: f.arrLat, code: f.arrIata || f.arrIcao || "?" };
      }
      if (!southernmost || f.arrLat < southernmost.lat) {
        southernmost = { lat: f.arrLat, code: f.arrIata || f.arrIcao || "?" };
      }
    }
  });

  // Longest travel chain (consecutive flights)
  let longestChain = 0;
  if (flownFlights.length > 0) {
    const sortedFlights = [...flownFlights].sort(
      (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
    );

    let currentChain = 1;
    for (let i = 1; i < sortedFlights.length; i++) {
      const prev = sortedFlights[i - 1];
      const curr = sortedFlights[i];

      // Check if current flight departs from where previous arrived (within 24 hours)
      const prevArrCode = prev.arrIata || prev.arrIcao;
      const currDepCode = curr.depIata || curr.depIcao;
      const timeDiff =
        new Date(curr.departureTime).getTime() - new Date(prev.arrivalTime).getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);

      if (
        prevArrCode &&
        currDepCode &&
        prevArrCode === currDepCode &&
        hoursDiff >= 0 &&
        hoursDiff <= 24
      ) {
        currentChain++;
      } else {
        longestChain = Math.max(longestChain, currentChain);
        currentChain = 1;
      }
    }
    longestChain = Math.max(longestChain, currentChain);
  }

  // Fastest route (highest average ground speed) — timezone-aware duration
  let fastestRoute: { route: string; speed: number } | null = null;

  flownFlights.forEach((f) => {
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      const distance = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);

      const depTz = departureTimezoneOf(f, timezoneMap);
      const arrTz = arrivalTimezoneOf(f, timezoneMap);

      // Deliberately NOT the stored `duration_minutes` column (forgejo#45).
      // `/unique` never selects `arrTimeSemantics`, so the call below defaults
      // it to 'UNKNOWN' and this tournament has always measured a naïve
      // difference for rows the column reports as NULL — a DATE_ONLY ARRIVAL,
      // or a LEGACY_FAKE_UTC pair. Reading the column here would silently drop
      // those flights out of the fastest-route contest, which is a counting
      // change, not a persistence one. Whether that difference is a bug is a
      // separate question from where the number is stored; answering it here
      // would move a figure on screen under cover of a schema change.
      const durationMinutes = tzAwareDurationMinutes(
        f.departureTime,
        f.arrivalTime,
        depTz,
        arrTz,
        (f as { depTimeSemantics?: FlightTimeSemantics }).depTimeSemantics,
        (f as { arrTimeSemantics?: FlightTimeSemantics }).arrTimeSemantics
      );
      // DATE_ONLY rows return null and are skipped from the fastest-route
      // tournament — placeholder times would produce nonsense ground speeds.
      const durationHours = durationMinutes === null ? 0 : durationMinutes / 60;

      if (durationHours > 0.5) {
        // Ignore flights with <30min duration (likely bad data)
        const speed = distance / durationHours; // km/h
        if (speed <= 1200 && (!fastestRoute || speed > fastestRoute.speed)) {
          fastestRoute = {
            route: `${f.depIata || f.depIcao || "?"}-${f.arrIata || f.arrIcao || "?"}`,
            speed: Math.round(speed),
          };
        }
      }
    }
  });

  // Most countries in one day
  // Grouped by the calendar day at the DEPARTURE airport, so a day that ends
  // after midnight UTC is still one day for the traveller. Two figures on the
  // same screen used to disagree about which day a flight belonged to: the
  // same-day and midnight counters below already read the local clock.
  const flightsByDate: Record<string, FlightData[]> = {};
  flownFlights.forEach((f) => {
    const dateKey = departureClockOf(f)?.date;
    if (!dateKey) return;
    if (!flightsByDate[dateKey]) {
      flightsByDate[dateKey] = [];
    }
    flightsByDate[dateKey].push(f);
  });

  let mostCountriesInDay = 0;
  let mostCountriesDate: string | null = null;

  try {
    const airports =
      airportsForTimezone.size > 0 ? airportsForTimezone : await getCachedAirports(airportCodes);

    Object.entries(flightsByDate).forEach(([date, dayFlights]) => {
      const countries = new Set<string>();
      dayFlights.forEach((f) => {
        const depCode = departureEndpointCode(f);
        const arrCode = arrivalEndpointCode(f);

        if (depCode) {
          const airport = airports.get(depCode);
          if (airport?.country) countries.add(airport.country);
        }
        if (arrCode) {
          const airport = airports.get(arrCode);
          if (airport?.country) countries.add(airport.country);
        }
      });

      if (countries.size > mostCountriesInDay) {
        mostCountriesInDay = countries.size;
        mostCountriesDate = date;
      }
    });
  } catch (error) {
    logger.error({
      operation: "calculate_unique_stats",
      message: "Failed to fetch airports for country calculation",
      error,
    });
  }

  // Hemisphere hopper — flights crossing between northern and southern
  // hemisphere. Geographic, time-insensitive. The SAME predicate as the
  // equator crossing above: two tiles, one rule, and therefore always the
  // same number.
  const hemisphereHops = countableFlights.filter(crossesHemisphere).length;

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
  // historical flights when the user knows it; UNKNOWN-year-only entries
  // bias toward winter (month defaults to 01) but the volume is small.
  const seasons = new Set<number>();
  countableFlights.forEach((f) => {
    const clock = departureClockOf(f);
    if (!clock) return;
    const month = clock.month; // 0-11
    // Northern hemisphere seasons
    if (month >= 2 && month <= 4) seasons.add(0); // Spring (Mar-May)
    if (month >= 5 && month <= 7) seasons.add(1); // Summer (Jun-Aug)
    if (month >= 8 && month <= 10) seasons.add(2); // Fall (Sep-Nov)
    if (month === 11 || month === 0 || month === 1) seasons.add(3); // Winter (Dec-Feb)
  });

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

  // Layovers — the waiting time between two consecutive flights at the same
  // airport. Capped at LAYOVER_CAP_HOURS so that the user's life at home (or
  // a 3-week vacation stopover) doesn't count as a "layover". The home
  // airport at the time of each flight is also excluded — otherwise every
  // return flight would produce a layover that spans whatever gap follows
  // before the next trip.
  let longestLayover: { hours: number; from: string; to: string } | null = null;
  let shortestLayover: { hours: number; from: string; to: string } | null = null;
  if (flownFlights.length > 1) {
    const sortedFlights = [...flownFlights].sort(
      (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
    );

    for (let i = 0; i < sortedFlights.length - 1; i++) {
      const current = sortedFlights[i];
      const next = sortedFlights[i + 1];

      const currentArrCode = current.arrIata || current.arrIcao || "?";
      const nextDepCode = next.depIata || next.depIcao || "?";

      // Same airport for end-of-current and start-of-next?
      if (currentArrCode !== nextDepCode) continue;

      // Exclude the home airport active at the time of arrival.
      const arrivalDay = new Date(current.arrivalTime).toISOString().slice(0, 10);
      const homeAtArrival = getHomeAirportAt(homeAirportHistory, arrivalDay);
      if (homeAtArrival && homeAtArrival === currentArrCode) continue;

      const layoverHours =
        (new Date(next.departureTime).getTime() - new Date(current.arrivalTime).getTime()) /
        (1000 * 60 * 60);

      // Must be positive (chronological) and within the cap.
      if (layoverHours <= 0 || layoverHours > LAYOVER_CAP_HOURS) continue;

      const rounded = Math.round(layoverHours * 10) / 10;
      const entry = { hours: rounded, from: currentArrCode, to: nextDepCode };
      if (!longestLayover || rounded > longestLayover.hours) longestLayover = entry;
      if (!shortestLayover || rounded < shortestLayover.hours) shortestLayover = entry;
    }
  }

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

  return {
    timeTravelIndex: timeTravelFlights,
    equatorCrossings,
    arcticFlights,
    oceanCrossings,
    highestAirport,
    northernmost,
    southernmost,
    longestTravelChain: longestChain,
    fastestRoute,
    mostCountriesInDay,
    mostCountriesDate,
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
    seasonalExplorer: seasons.size === 4,
    seasonsCount: seasons.size,
    internationalVsDomestic: {
      international: internationalFlights,
      domestic: domesticFlights,
      ratio:
        domesticFlights > 0
          ? Math.round((internationalFlights / domesticFlights) * 100) / 100
          : internationalFlights,
    },
    longestLayover,
    shortestLayover,
    roundTripMaster: roundTripCount,
  };
}

// toLocalDateString now lives in utils/timezone alongside localWallClockOf —
// had been copied here, and a second copy was about to be written for the
// year-scoped country index.
