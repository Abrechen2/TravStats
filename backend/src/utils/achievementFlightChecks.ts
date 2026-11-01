// Flight-derived achievement helpers (consecutive months, ocean/equator/polar
// crossings, seasons). Split from `achievementChecks.ts` (forgejo#386, REF-16)
// so the dispatch module stays under the 800-line limit.

import { calculateDistance } from "./geo";
import { departureClockOf } from "./timezone";
import type { FlightData } from "./achievementStats";

const monthNumber = (key: string): number => Number(key.slice(0, 4)) * 12 + Number(key.slice(5));
export function checkConsecutiveMonths(monthsWithFlights: Set<string>): number {
  if (monthsWithFlights.size === 0) return 0;

  const sortedMonths = Array.from(monthsWithFlights).sort();
  let maxConsecutive = 1;
  let currentConsecutive = 1;

  for (let i = 1; i < sortedMonths.length; i++) {
    // "YYYY-MM" keys as month counts — read as Dates, "2024-03-01" on a host
    // west of UTC was February.
    const monthDiff = monthNumber(sortedMonths[i]) - monthNumber(sortedMonths[i - 1]);

    if (monthDiff === 1) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 1;
    }
  }

  return maxConsecutive;
}

export function checkOceanCrossing(flights: FlightData[]): boolean {
  for (const flight of flights) {
    const distance = calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon);
    // Simple heuristic: flights over 5000km likely cross an ocean
    if (distance > 5000) {
      return true;
    }
  }
  return false;
}

export function checkTimeTravel(flights: FlightData[]): boolean {
  for (const flight of flights) {
    // Arrive before departure (in UTC) — skip historical flights with null times
    if (flight.arrivalTime && flight.departureTime && flight.arrivalTime < flight.departureTime) {
      return true;
    }
  }
  return false;
}

export function checkArcticFlight(flights: FlightData[]): boolean {
  const arcticCircle = 66.5;
  for (const flight of flights) {
    if (flight.depLat >= arcticCircle || flight.arrLat >= arcticCircle) {
      return true;
    }
  }
  return false;
}

export function checkAntarcticFlight(flights: FlightData[]): boolean {
  const antarcticCircle = -66.5;
  for (const flight of flights) {
    if (flight.depLat <= antarcticCircle || flight.arrLat <= antarcticCircle) {
      return true;
    }
  }
  return false;
}

export function checkEquatorCrossing(flights: FlightData[]): boolean {
  for (const flight of flights) {
    // Check if flight crosses equator (one hemisphere to another)
    if ((flight.depLat > 0 && flight.arrLat < 0) || (flight.depLat < 0 && flight.arrLat > 0)) {
      return true;
    }
  }
  return false;
}

export function checkAllSeasons(flights: FlightData[]): number {
  // Northern hemisphere seasons
  const seasons = new Set<number>();
  for (const flight of flights) {
    if (!flight.departureTime) continue;
    const { month } = departureClockOf(flight.departureTime, flight); // 0-11, airport's calendar
    if (month >= 2 && month <= 4) seasons.add(0); // Spring (Mar-May)
    if (month >= 5 && month <= 7) seasons.add(1); // Summer (Jun-Aug)
    if (month >= 8 && month <= 10) seasons.add(2); // Fall (Sep-Nov)
    if (month === 11 || month === 0 || month === 1) seasons.add(3); // Winter (Dec-Feb)
  }
  return seasons.size;
}
