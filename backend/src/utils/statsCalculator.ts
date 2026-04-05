import { calculateDistance } from './geo';
import { getCachedAirports } from '../services/airportCache';
import logger from './logger';

interface FunStats {
  timezoneHopper: number;
  earlyBird: number;
  afternoon: number;
  nightOwl: number;
  weekendWarrior: number;
  weekendPercentage: number;
  loyaltyScore: number;
  mostUsedAirline: string | null;
  shortHaulKing: number;
  longHaulPilot: number;
  fastestDay: string | null;
  fastestDayFlights: number;
  co2FootprintKg: number;
  co2InElephants: number;
  milestoneYear: number | null;
  milestoneYearFlights: number;
  routeMaster: string | null;
  routeMasterCount: number;
}

interface BusinessStats {
  costPerKm: number;
  costPerHour: number;
  totalCost: number;
  totalDistance: number;
  seatClassDistribution: Record<string, number>;
  mostCommonCategory: string | null;
  airportDiversity: number;
  avgFlightDuration: number;
  busiestMonth: string | null;
  busiestMonthFlights: number;
  categoryDistribution: Record<string, number>;
}

interface UniqueStats {
  timeTravelIndex: number;
  equatorCrossings: number;
  arcticFlights: number;
  oceanCrossings: number;
  highestAirport: { code: string; name: string; altitude: number } | null;
  northernmost: { lat: number; code: string } | null;
  southernmost: { lat: number; code: string } | null;
  longestTravelChain: number;
  fastestRoute: { route: string; speed: number } | null;
  mostCountriesInDay: number;
  mostCountriesDate: string | null;
  hemisphereHops: number;
  dateLineCrossings: number;
  continentalExplorer: number;
  continents: string[];
  tropicsTraveler: number;
  eastWestBalance: {
    eastward: number;
    westward: number;
    ratio: number;
  };
  sameDayReturns: number;
  midnightFlights: number;
  seasonalExplorer: boolean;
  seasonsCount: number;
  internationalVsDomestic: {
    international: number;
    domestic: number;
    ratio: number;
  };
  longestLayover: { hours: number; from: string; to: string } | null;
  roundTripMaster: number;
}

interface FlightData {
  id: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  depIata?: string | null;
  depIcao?: string | null;
  arrIata?: string | null;
  arrIcao?: string | null;
  airline?: string | null;
  aircraft?: string | null;
  departureTime: Date;
  arrivalTime: Date;
  status: string;
  price?: number | null;
  taxes?: number | null;
  fees?: number | null;
  category?: string | null;
  seatClass?: string | null;
  createdAt: Date;
}

/**
 * Calculate fun/entertaining statistics
 */
export async function calculateFunStats(flights: FlightData[]): Promise<FunStats> {
  const flownFlights = flights.filter(f => f.status === 'flown');

  // Timezone hopper - count unique timezones
  const timezones = new Set<string>();
  const airportCodes = new Set<string>();

  for (const flight of flownFlights) {
    if (flight.depIata) airportCodes.add(flight.depIata);
    if (flight.depIcao) airportCodes.add(flight.depIcao);
    if (flight.arrIata) airportCodes.add(flight.arrIata);
    if (flight.arrIcao) airportCodes.add(flight.arrIcao);
  }

  try {
    const airports = await getCachedAirports(Array.from(airportCodes));
    for (const airport of airports.values()) {
      if (airport?.timezone) {
        timezones.add(airport.timezone);
      }
    }
  } catch (error) {
    logger.error({ operation: 'calculate_fun_stats', message: 'Failed to fetch airports for timezone calculation', error });
  }

  // Early bird vs night owl
  const morningFlights = flownFlights.filter(f => {
    const hour = new Date(f.departureTime).getHours();
    return hour >= 6 && hour < 12;
  }).length;

  const afternoonFlights = flownFlights.filter(f => {
    const hour = new Date(f.departureTime).getHours();
    return hour >= 12 && hour < 18;
  }).length;

  const eveningFlights = flownFlights.filter(f => {
    const hour = new Date(f.departureTime).getHours();
    return hour >= 18 || hour < 6;
  }).length;

  // Weekend warrior
  const weekendFlights = flownFlights.filter(f => {
    const day = new Date(f.departureTime).getDay();
    return day === 0 || day === 6;
  }).length;

  // Loyalty score - percentage with most used airline
  const airlineCounts: Record<string, number> = {};
  flownFlights.forEach(f => {
    if (f.airline) {
      airlineCounts[f.airline] = (airlineCounts[f.airline] || 0) + 1;
    }
  });

  const maxAirlineCount = Math.max(0, ...Object.values(airlineCounts));
  const loyaltyScore = flownFlights.length > 0
    ? Math.round((maxAirlineCount / flownFlights.length) * 100)
    : 0;

  // Short haul king - flights under 500km
  const shortHaulFlights = flownFlights.filter(f => {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) return false;
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    return dist < 500;
  }).length;

  // Long haul pilot - flights over 5000km
  const longHaulFlights = flownFlights.filter(f => {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) return false;
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    return dist >= 5000;
  }).length;

  // Fastest day - day with most flights
  const flightsByDate: Record<string, number> = {};
  flownFlights.forEach(f => {
    const dateKey = new Date(f.departureTime).toISOString().split('T')[0];
    flightsByDate[dateKey] = (flightsByDate[dateKey] || 0) + 1;
  });

  const maxFlightsOnDay = Math.max(0, ...Object.values(flightsByDate));
  const fastestDay = Object.entries(flightsByDate).find(([, count]) => count === maxFlightsOnDay)?.[0];

  // CO2 footprint in elephants (rough estimate: 1kg CO2 per km, elephant = 4000kg)
  let totalCO2kg = 0;
  flownFlights.forEach(f => {
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      // Rough estimate: 0.25kg CO2 per passenger per km for short haul, 0.2kg for long haul
      const co2PerKm = dist < 1500 ? 0.25 : 0.2;
      totalCO2kg += dist * co2PerKm;
    }
  });
  const elephants = totalCO2kg / 4000;

  // Milestone years - years with most flights
  const flightsByYear: Record<number, number> = {};
  flownFlights.forEach(f => {
    const year = new Date(f.departureTime).getFullYear();
    flightsByYear[year] = (flightsByYear[year] || 0) + 1;
  });

  const topYear = Object.entries(flightsByYear)
    .sort(([, a], [, b]) => b - a)[0];

  // Route master - most frequent route
  const routeCounts: Record<string, number> = {};
  flownFlights.forEach(f => {
    const route = `${f.depIata || f.depIcao || '?'}-${f.arrIata || f.arrIcao || '?'}`;
    routeCounts[route] = (routeCounts[route] || 0) + 1;
  });

  const topRoute = Object.entries(routeCounts)
    .sort(([, a], [, b]) => b - a)[0];

  return {
    timezoneHopper: timezones.size,
    earlyBird: morningFlights,
    afternoon: afternoonFlights,
    nightOwl: eveningFlights,
    weekendWarrior: weekendFlights,
    weekendPercentage: flownFlights.length > 0
      ? Math.round((weekendFlights / flownFlights.length) * 100)
      : 0,
    loyaltyScore,
    mostUsedAirline: Object.entries(airlineCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null,
    shortHaulKing: shortHaulFlights,
    longHaulPilot: longHaulFlights,
    fastestDay: fastestDay || null,
    fastestDayFlights: maxFlightsOnDay,
    co2FootprintKg: Math.round(totalCO2kg),
    co2InElephants: Math.round(elephants * 10) / 10,
    milestoneYear: topYear ? parseInt(topYear[0]) : null,
    milestoneYearFlights: topYear ? topYear[1] : 0,
    routeMaster: topRoute ? topRoute[0] : null,
    routeMasterCount: topRoute ? topRoute[1] : 0,
  };
}

/**
 * Calculate business/informative statistics
 */
export function calculateBusinessStats(flights: FlightData[]): BusinessStats {
  const flownFlights = flights.filter(f => f.status === 'flown');

  // Cost per kilometer — only consider flights that have a cost entry so the denominator
  // (distance) is not inflated by cost-free flights.
  let totalDistance = 0;
  let totalCost = 0;
  let totalDistanceWithCost = 0;

  flownFlights.forEach(f => {
    const hasCoordsForDistance =
      f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null;
    const dist = hasCoordsForDistance
      ? calculateDistance(f.depLat!, f.depLon!, f.arrLat!, f.arrLon!)
      : 0;

    if (hasCoordsForDistance) {
      totalDistance += dist;
    }

    const flightCost = (f.price || 0) + (f.taxes || 0) + (f.fees || 0);
    if (flightCost > 0) {
      totalCost += flightCost;
      if (hasCoordsForDistance) {
        totalDistanceWithCost += dist;
      }
    }
  });

  const costPerKm = totalDistanceWithCost > 0 && totalCost > 0
    ? Math.round((totalCost / totalDistanceWithCost) * 100) / 100
    : 0;

  // Cost per flight hour — only include hours for flights that have a cost entry.
  let totalFlightHours = 0;
  let totalCostForHours = 0;
  let totalFlightHoursWithCost = 0;

  flownFlights.forEach(f => {
    const hours = (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / (1000 * 60 * 60);
    if (hours > 0) {
      totalFlightHours += hours;

      const flightCost = (f.price || 0) + (f.taxes || 0) + (f.fees || 0);
      if (flightCost > 0) {
        totalCostForHours += flightCost;
        totalFlightHoursWithCost += hours;
      }
    }
  });

  const costPerHour = totalFlightHoursWithCost > 0 && totalCostForHours > 0
    ? Math.round((totalCostForHours / totalFlightHoursWithCost) * 100) / 100
    : 0;

  // Seat class distribution
  const seatClassCounts: Record<string, number> = {};
  flownFlights.forEach(f => {
    const seatClass = f.seatClass || 'unknown';
    seatClassCounts[seatClass] = (seatClassCounts[seatClass] || 0) + 1;
  });

  const seatClassDistribution: Record<string, number> = {};
  Object.entries(seatClassCounts).forEach(([seatClass, count]) => {
    seatClassDistribution[seatClass] = flownFlights.length > 0
      ? Math.round((count / flownFlights.length) * 100)
      : 0;
  });

  // Category distribution
  const categoryCounts: Record<string, number> = {};
  flownFlights.forEach(f => {
    const category = f.category || 'unassigned';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  const mostCommonCategory = Object.entries(categoryCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

  // Airport diversity — prefer IATA, fall back to ICAO; one code per physical airport.
  const uniqueAirports = new Set<string>();
  flownFlights.forEach(f => {
    const dep = f.depIata || f.depIcao;
    if (dep) uniqueAirports.add(dep);
    const arr = f.arrIata || f.arrIcao;
    if (arr) uniqueAirports.add(arr);
  });

  // Average flight duration
  const flightDurations = flownFlights
    .map(f => {
      const hours = (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / (1000 * 60 * 60);
      return hours > 0 ? hours : null;
    })
    .filter((h): h is number => h !== null);

  const avgFlightDuration = flightDurations.length > 0
    ? Math.round((flightDurations.reduce((a, b) => a + b, 0) / flightDurations.length) * 10) / 10
    : 0;

  // Seasonal analysis
  const flightsByMonth: Record<number, number> = {};
  flownFlights.forEach(f => {
    const month = new Date(f.departureTime).getMonth(); // 0-11
    flightsByMonth[month] = (flightsByMonth[month] || 0) + 1;
  });

  const busiestMonth = Object.entries(flightsByMonth)
    .sort(([, a], [, b]) => b - a)[0];

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return {
    costPerKm,
    costPerHour,
    totalCost: Math.round(totalCost * 100) / 100,
    totalDistance: Math.round(totalDistance),
    seatClassDistribution,
    mostCommonCategory,
    airportDiversity: uniqueAirports.size,
    avgFlightDuration,
    busiestMonth: busiestMonth ? monthNames[parseInt(busiestMonth[0])] : null,
    busiestMonthFlights: busiestMonth ? busiestMonth[1] : 0,
    categoryDistribution: categoryCounts,
  };
}

/**
 * Calculate unique/special statistics
 */
export async function calculateUniqueStats(flights: FlightData[]): Promise<UniqueStats> {
  const flownFlights = flights.filter(f => f.status === 'flown');

  // Time travel index - flights where local arrival time appears to be before local departure time.
  //
  // TODO: Proper implementation requires per-airport timezone data (e.g. "Europe/Berlin").
  // The FlightData type does not currently include depTimezone/arrTimezone fields.
  // A schema migration adding those fields would allow: convert dep/arr UTC times to local
  // times using the respective timezone, then compare local hours.
  //
  // Current approximation: flag flights where UTC arrival is before UTC departure (data-entry
  // errors only, not real timezone-crossing flights) or where the reported duration is
  // implausibly short for the distance (< 1 hour for > 1000 km). This is a weak heuristic
  // and will miss genuine westward long-haul flights (e.g. JFK→LHR arrives "earlier" locally).
  let timeTravelFlights = 0;
  flownFlights.forEach(f => {
    const depTime = new Date(f.departureTime);
    const arrTime = new Date(f.arrivalTime);

    const duration = arrTime.getTime() - depTime.getTime();
    const distance = f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null
      ? calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon)
      : 0;

    if (duration < 0 || (duration < 3600000 && distance > 1000)) {
      timeTravelFlights++;
    }
  });

  // Equator crossings
  let equatorCrossings = 0;
  flownFlights.forEach(f => {
    if (f.depLat != null && f.arrLat != null) {
      // Check if flight crosses equator (one hemisphere to another)
      if ((f.depLat > 0 && f.arrLat < 0) || (f.depLat < 0 && f.arrLat > 0)) {
        equatorCrossings++;
      }
    }
  });

  // Arctic circle flights (north of 66.5°)
  const arcticCircle = 66.5;
  const arcticFlights = flownFlights.filter(f => {
    return (f.depLat != null && f.depLat >= arcticCircle) ||
           (f.arrLat != null && f.arrLat >= arcticCircle);
  }).length;

  // Ocean crossings - simplified heuristic: flights over 5000km likely cross an ocean
  const oceanCrossings = flownFlights.filter(f => {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) return false;
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    return dist > 5000;
  }).length;

  // Highest airport (altitude)
  const airportCodes = new Set<string>();
  flownFlights.forEach(f => {
    if (f.depIata) airportCodes.add(f.depIata);
    if (f.depIcao) airportCodes.add(f.depIcao);
    if (f.arrIata) airportCodes.add(f.arrIata);
    if (f.arrIcao) airportCodes.add(f.arrIcao);
  });

  let highestAirport: { code: string; name: string; altitude: number } | null = null;

  try {
    const airports = await getCachedAirports(Array.from(airportCodes));
    for (const [code, airport] of airports.entries()) {
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
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for altitude calculation', error });
  }

  // Northernmost and southernmost points
  let northernmost: { lat: number; code: string } | null = null;
  let southernmost: { lat: number; code: string } | null = null;

  flownFlights.forEach(f => {
    if (f.depLat != null) {
      if (!northernmost || f.depLat > northernmost.lat) {
        northernmost = { lat: f.depLat, code: f.depIata || f.depIcao || '?' };
      }
      if (!southernmost || f.depLat < southernmost.lat) {
        southernmost = { lat: f.depLat, code: f.depIata || f.depIcao || '?' };
      }
    }
    if (f.arrLat != null) {
      if (!northernmost || f.arrLat > northernmost.lat) {
        northernmost = { lat: f.arrLat, code: f.arrIata || f.arrIcao || '?' };
      }
      if (!southernmost || f.arrLat < southernmost.lat) {
        southernmost = { lat: f.arrLat, code: f.arrIata || f.arrIcao || '?' };
      }
    }
  });

  // Longest travel chain (consecutive flights)
  let longestChain = 0;
  if (flownFlights.length > 0) {
    const sortedFlights = [...flownFlights].sort((a, b) =>
      new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
    );

    let currentChain = 1;
    for (let i = 1; i < sortedFlights.length; i++) {
      const prev = sortedFlights[i - 1];
      const curr = sortedFlights[i];

      // Check if current flight departs from where previous arrived (within 24 hours)
      const prevArrCode = prev.arrIata || prev.arrIcao;
      const currDepCode = curr.depIata || curr.depIcao;
      const timeDiff = new Date(curr.departureTime).getTime() - new Date(prev.arrivalTime).getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);

      if (prevArrCode && currDepCode && prevArrCode === currDepCode && hoursDiff >= 0 && hoursDiff <= 24) {
        currentChain++;
      } else {
        longestChain = Math.max(longestChain, currentChain);
        currentChain = 1;
      }
    }
    longestChain = Math.max(longestChain, currentChain);
  }

  // Fastest route (highest average speed)
  let fastestRoute: { route: string; speed: number } | null = null;

  flownFlights.forEach(f => {
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      const distance = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      const duration = (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / (1000 * 60 * 60); // hours

      if (duration > 0) {
        const speed = distance / duration; // km/h
        if (!fastestRoute || speed > fastestRoute.speed) {
          fastestRoute = {
            route: `${f.depIata || f.depIcao || '?'}-${f.arrIata || f.arrIcao || '?'}`,
            speed: Math.round(speed),
          };
        }
      }
    }
  });

  // Most countries in one day
  const flightsByDate: Record<string, FlightData[]> = {};
  flownFlights.forEach(f => {
    const dateKey = new Date(f.departureTime).toISOString().split('T')[0];
    if (!flightsByDate[dateKey]) {
      flightsByDate[dateKey] = [];
    }
    flightsByDate[dateKey].push(f);
  });

  let mostCountriesInDay = 0;
  let mostCountriesDate: string | null = null;

  try {
    const airports = await getCachedAirports(Array.from(airportCodes));

    Object.entries(flightsByDate).forEach(([date, dayFlights]) => {
      const countries = new Set<string>();
      dayFlights.forEach(f => {
        const depCode = f.depIata || f.depIcao;
        const arrCode = f.arrIata || f.arrIcao;

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
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for country calculation', error });
  }

  // Hemisphere hopper - flights crossing between northern and southern hemisphere
  let hemisphereHops = 0;
  flownFlights.forEach(f => {
    if (f.depLat != null && f.arrLat != null) {
      // Check if flight crosses from one hemisphere to another
      if ((f.depLat > 0 && f.arrLat < 0) || (f.depLat < 0 && f.arrLat > 0)) {
        hemisphereHops++;
      }
    }
  });

  // Date line crosser - flights crossing the International Date Line (180° longitude)
  let dateLineCrossings = 0;
  flownFlights.forEach(f => {
    if (f.depLon != null && f.arrLon != null) {
      // Check if flight crosses the date line (180° or -180°)
      const lonDiff = Math.abs(f.arrLon - f.depLon);
      // If the difference is greater than 180°, the flight likely crossed the date line
      if (lonDiff > 180) {
        dateLineCrossings++;
      }
    }
  });

  // Continental explorer - count unique continents
  const continents = new Set<string>();
  try {
    const airports = await getCachedAirports(Array.from(airportCodes));
    flownFlights.forEach(f => {
      const depCode = f.depIata || f.depIcao;
      const arrCode = f.arrIata || f.arrIcao;

      if (depCode) {
        const airport = airports.get(depCode);
        if (airport) {
          const continent = getContinentFromCoordinates(airport.lat, airport.lon);
          if (continent) continents.add(continent);
        }
      }
      if (arrCode) {
        const airport = airports.get(arrCode);
        if (airport) {
          const continent = getContinentFromCoordinates(airport.lat, airport.lon);
          if (continent) continents.add(continent);
        }
      }
    });
  } catch (error) {
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for continent calculation', error });
  }

  // Tropics traveler - flights within the tropics (between 23.5°N and 23.5°S)
  const tropicOfCancer = 23.5;
  const tropicOfCapricorn = -23.5;
  const tropicsFlights = flownFlights.filter(f => {
    if (f.depLat == null || f.arrLat == null) return false;
    // Check if both departure and arrival are within tropics
    const depInTropics = f.depLat >= tropicOfCapricorn && f.depLat <= tropicOfCancer;
    const arrInTropics = f.arrLat >= tropicOfCapricorn && f.arrLat <= tropicOfCancer;
    return depInTropics || arrInTropics;
  }).length;

  // East-West balance - ratio of eastward vs westward flights
  let eastwardFlights = 0;
  let westwardFlights = 0;
  flownFlights.forEach(f => {
    if (f.depLon != null && f.arrLon != null) {
      let lonDiff = f.arrLon - f.depLon;
      // Handle date line crossing
      if (lonDiff > 180) lonDiff -= 360;
      if (lonDiff < -180) lonDiff += 360;

      if (lonDiff > 0) eastwardFlights++;
      else if (lonDiff < 0) westwardFlights++;
    }
  });

  // Same-day return - flights that return on the same day
  const sameDayReturns = flownFlights.filter(f => {
    const depDate = new Date(f.departureTime).toDateString();
    const arrDate = new Date(f.arrivalTime).toDateString();
    return depDate === arrDate;
  }).length;

  // Midnight flyer - flights that cross midnight
  const midnightFlights = flownFlights.filter(f => {
    const depDate = new Date(f.departureTime);
    const arrDate = new Date(f.arrivalTime);
    return depDate.toDateString() !== arrDate.toDateString();
  }).length;

  // Seasonal explorer - flights in all 4 seasons
  const seasons = new Set<number>();
  flownFlights.forEach(f => {
    const month = new Date(f.departureTime).getMonth(); // 0-11
    // Northern hemisphere seasons
    if (month >= 2 && month <= 4) seasons.add(0); // Spring (Mar-May)
    if (month >= 5 && month <= 7) seasons.add(1); // Summer (Jun-Aug)
    if (month >= 8 && month <= 10) seasons.add(2); // Fall (Sep-Nov)
    if (month === 11 || month === 0 || month === 1) seasons.add(3); // Winter (Dec-Feb)
  });

  // International vs domestic - ratio based on countries
  let internationalFlights = 0;
  let domesticFlights = 0;
  try {
    const airports = await getCachedAirports(Array.from(airportCodes));
    flownFlights.forEach(f => {
      const depCode = f.depIata || f.depIcao;
      const arrCode = f.arrIata || f.arrIcao;

      if (depCode && arrCode) {
        const depAirport = airports.get(depCode);
        const arrAirport = airports.get(arrCode);

        if (depAirport?.country && arrAirport?.country) {
          if (depAirport.country === arrAirport.country) {
            domesticFlights++;
          } else {
            internationalFlights++;
          }
        }
      }
    });
  } catch (error) {
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for international/domestic calculation', error });
  }

  // Longest layover - longest time between consecutive flights
  let longestLayover: { hours: number; from: string; to: string } | null = null;
  if (flownFlights.length > 1) {
    const sortedFlights = [...flownFlights].sort((a, b) =>
      new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
    );

    for (let i = 0; i < sortedFlights.length - 1; i++) {
      const current = sortedFlights[i];
      const next = sortedFlights[i + 1];

      const currentArrCode = current.arrIata || current.arrIcao || '?';
      const nextDepCode = next.depIata || next.depIcao || '?';

      // Check if next flight departs from where current arrived
      if (currentArrCode === nextDepCode) {
        const layoverHours = (new Date(next.departureTime).getTime() - new Date(current.arrivalTime).getTime()) / (1000 * 60 * 60);

        if (layoverHours > 0 && (!longestLayover || layoverHours > longestLayover.hours)) {
          longestLayover = {
            hours: Math.round(layoverHours * 10) / 10,
            from: currentArrCode,
            to: nextDepCode,
          };
        }
      }
    }
  }

  // Round trip master - count complete round trips (A->B->A)
  const roundTrips = new Map<string, number>();
  flownFlights.forEach(f => {
    const depCode = f.depIata || f.depIcao;
    const arrCode = f.arrIata || f.arrIcao;

    if (depCode && arrCode) {
      const routeKey = `${depCode}-${arrCode}`;
      const returnKey = `${arrCode}-${depCode}`;

      // Check if return flight exists
      const hasReturn = flownFlights.some(flight => {
        const fDep = flight.depIata || flight.depIcao;
        const fArr = flight.arrIata || flight.arrIcao;
        return fDep === arrCode && fArr === depCode;
      });

      if (hasReturn) {
        roundTrips.set(routeKey, (roundTrips.get(routeKey) || 0) + 1);
      }
    }
  });
  const roundTripCount = Math.floor(Array.from(roundTrips.values()).reduce((a, b) => a + b, 0) / 2);

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
      ratio: westwardFlights > 0 ? Math.round((eastwardFlights / westwardFlights) * 100) / 100 : eastwardFlights,
    },
    sameDayReturns,
    midnightFlights,
    seasonalExplorer: seasons.size === 4,
    seasonsCount: seasons.size,
    internationalVsDomestic: {
      international: internationalFlights,
      domestic: domesticFlights,
      ratio: domesticFlights > 0 ? Math.round((internationalFlights / domesticFlights) * 100) / 100 : internationalFlights,
    },
    longestLayover,
    roundTripMaster: roundTripCount,
  };
}

/**
 * Get continent from coordinates (simplified)
 * Similar to getContinent in achievements.ts — keep both in sync when updating boundaries.
 */
function getContinentFromCoordinates(lat: number, lon: number): string | null {
  // Simplified continent detection based on coordinates — rough approximation.
  if (lat > 70 || lat < -60) return 'Antarctica';
  if (lon >= -170 && lon <= -30) {
    return lat > 15 ? 'North America' : 'South America';
  }
  // Middle East: roughly Israel/Jordan east to Iran/UAE, lat 10°–42°N
  // Lower lon bound at 30° keeps Turkey (Istanbul lon ~29) in Europe.
  if (lon >= 30 && lon <= 63 && lat >= 10 && lat <= 42) return 'Middle East';
  // Europe: lon -30° to 40°, lat > 35°N
  if (lon >= -30 && lon <= 40 && lat > 35) return 'Europe';
  // Africa: lon -20° to 55°, lat -35° to 35°
  if (lon >= -20 && lon <= 55 && lat >= -35 && lat < 35) return 'Africa';
  if (lon >= 60 && lon <= 150) return 'Asia';
  if (lon >= 150 || lon <= -170) return 'Oceania';
  return null;
}
