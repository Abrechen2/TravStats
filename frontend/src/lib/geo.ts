/**
 * Geospatial utility functions
 * Provides accurate distance calculations using the Haversine formula
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of point 1 (degrees)
 * @param lon1 Longitude of point 1 (degrees)
 * @param lat2 Latitude of point 2 (degrees)
 * @param lon2 Longitude of point 2 (degrees)
 * @returns Distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}

/**
 * Calculate flight duration in minutes
 * @param departureTime ISO datetime string
 * @param arrivalTime ISO datetime string
 * @returns Duration in minutes
 */
export function calculateFlightDuration(
  departureTime: string,
  arrivalTime: string
): number {
  const departure = new Date(departureTime).getTime();
  const arrival = new Date(arrivalTime).getTime();
  return (arrival - departure) / 60000; // Convert ms to minutes
}

/**
 * Calculate flight duration in hours (formatted)
 * @param departureTime ISO datetime string
 * @param arrivalTime ISO datetime string
 * @returns Duration in hours with 1 decimal place
 */
export function calculateFlightDurationHours(
  departureTime: string,
  arrivalTime: string
): number {
  const minutes = calculateFlightDuration(departureTime, arrivalTime);
  return Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal
}
