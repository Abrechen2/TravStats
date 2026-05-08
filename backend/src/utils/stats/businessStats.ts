import { calculateDistance } from '../geo';
import type { FlightData, BusinessStats } from './types';

/**
 * Calculate business/informative statistics.
 *
 * Selective filtering — historical flights have unreliable times so we split
 * the input set:
 *   - `flownFlights`     : `flown` only with both times set. Used for
 *                          duration-dependent metrics: avgFlightDuration and
 *                          costPerHour.
 *   - `countableFlights` : `flown` + `historical`. Used for everything that
 *                          is time-insensitive: costPerKm (distance based),
 *                          seatClassDistribution, mostCommonCategory,
 *                          airportDiversity, busiestMonth (year+month is
 *                          reliable enough), totalDistance, totalCost,
 *                          categoryDistribution.
 */
export function calculateBusinessStats(flights: FlightData[]): BusinessStats {
  // Time-sensitive subset — both times must be present.
  const flownFlights = flights.filter(
    (f): f is typeof f & { departureTime: Date; arrivalTime: Date } =>
      f.status === 'flown' && f.departureTime !== null && f.arrivalTime !== null
  );

  // Time-insensitive subset — flown + historical contribute to distance,
  // cost, category, and airport coverage.
  const countableFlights = flights.filter(
    (f) => f.status === 'flown' || f.status === 'historical'
  );

  // Cost per kilometer — only consider flights that have a cost entry so the denominator
  // (distance) is not inflated by cost-free flights.
  // Deduplicate costs: if flights share a booking, count the booking price once.
  let totalDistance = 0;
  let totalCost = 0;
  let totalDistanceWithCost = 0;

  const seenBookingIds = new Set<string>();

  for (const f of countableFlights) {
    const hasCoordsForDistance =
      f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null;
    const dist = hasCoordsForDistance
      ? calculateDistance(f.depLat!, f.depLon!, f.arrLat!, f.arrLon!)
      : 0;

    if (hasCoordsForDistance) {
      totalDistance += dist;
    }

    let flightCost = 0;
    if (f.bookingId && f.booking?.price) {
      // Use booking price — count only once per booking
      if (!seenBookingIds.has(f.bookingId)) {
        seenBookingIds.add(f.bookingId);
        flightCost = f.booking.price;
      }
    } else {
      // No booking — use per-flight price (legacy)
      flightCost = (f.price ?? 0) + (f.taxes ?? 0) + (f.fees ?? 0);
    }

    if (flightCost > 0) {
      totalCost += flightCost;
    }

    // Count distance for all flights with any cost attribution
    const hasCostAttribution =
      flightCost > 0 ||
      (f.bookingId != null && seenBookingIds.has(f.bookingId) && (f.booking?.price ?? 0) > 0);
    if (hasCostAttribution && hasCoordsForDistance) {
      totalDistanceWithCost += dist;
    }
  }

  const costPerKm = totalDistanceWithCost > 0 && totalCost > 0
    ? Math.round((totalCost / totalDistanceWithCost) * 100) / 100
    : 0;

  // Cost per flight hour — only include hours for flights that have a cost entry.
  // Time-sensitive: requires precise duration, so flown-only.
  let totalCostForHours = 0;
  let totalFlightHoursWithCost = 0;

  const seenBookingIdsHours = new Set<string>();

  for (const f of flownFlights) {
    const hours = (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / (1000 * 60 * 60);
    if (hours > 0) {
      let flightCost = 0;
      if (f.bookingId && f.booking?.price) {
        if (!seenBookingIdsHours.has(f.bookingId)) {
          seenBookingIdsHours.add(f.bookingId);
          flightCost = f.booking.price;
        }
      } else {
        flightCost = (f.price ?? 0) + (f.taxes ?? 0) + (f.fees ?? 0);
      }

      if (flightCost > 0) {
        totalCostForHours += flightCost;
        totalFlightHoursWithCost += hours;
      } else if (f.bookingId != null && seenBookingIdsHours.has(f.bookingId) && (f.booking?.price ?? 0) > 0) {
        // Additional flight in same booking — count its hours but no extra cost
        totalFlightHoursWithCost += hours;
      }
    }
  }

  const costPerHour = totalFlightHoursWithCost > 0 && totalCostForHours > 0
    ? Math.round((totalCostForHours / totalFlightHoursWithCost) * 100) / 100
    : 0;

  // Seat class distribution (time-insensitive).
  const seatClassCounts: Record<string, number> = {};
  countableFlights.forEach(f => {
    const seatClass = f.seatClass || 'unknown';
    seatClassCounts[seatClass] = (seatClassCounts[seatClass] || 0) + 1;
  });

  const seatClassDistribution: Record<string, number> = {};
  Object.entries(seatClassCounts).forEach(([seatClass, count]) => {
    seatClassDistribution[seatClass] = countableFlights.length > 0
      ? Math.round((count / countableFlights.length) * 100)
      : 0;
  });

  // Category distribution (time-insensitive).
  const categoryCounts: Record<string, number> = {};
  countableFlights.forEach(f => {
    const category = f.category || 'unassigned';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  const mostCommonCategory = Object.entries(categoryCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

  // Airport diversity — prefer IATA, fall back to ICAO; one code per physical airport.
  // Time-insensitive.
  const uniqueAirports = new Set<string>();
  countableFlights.forEach(f => {
    const dep = f.depIata || f.depIcao;
    if (dep) uniqueAirports.add(dep);
    const arr = f.arrIata || f.arrIcao;
    if (arr) uniqueAirports.add(arr);
  });

  // Average flight duration — needs precise times, flown-only.
  const flightDurations = flownFlights
    .map(f => {
      const hours = (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / (1000 * 60 * 60);
      return hours > 0 ? hours : null;
    })
    .filter((h): h is number => h !== null);

  const avgFlightDuration = flightDurations.length > 0
    ? Math.round((flightDurations.reduce((a, b) => a + b, 0) / flightDurations.length) * 10) / 10
    : 0;

  // Seasonal analysis — month is reliable for historical flights when the
  // user knows the month (e.g. "March 1989"); UNKNOWN-year-only entries
  // default month to January which slightly biases the count toward winter,
  // but the absolute number of such entries is expected to be tiny.
  const flightsByMonth: Record<number, number> = {};
  countableFlights.forEach(f => {
    if (!f.departureTime) return;
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
