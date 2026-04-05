/**
 * Route Estimation Service
 *
 * Provides fallback route estimation when live route data is unavailable.
 * Uses various methods: Great Circle, known routes, polar routes, etc.
 */

import { calculateDistance } from '../utils/geo';

// Bounding-Box data for common overflight countries
const COUNTRY_BBOXES: Array<{
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}> = [
  { name: 'Germany', minLat: 47.2, maxLat: 55.1, minLon: 5.8, maxLon: 15.0 },
  { name: 'France', minLat: 41.3, maxLat: 51.1, minLon: -5.1, maxLon: 9.6 },
  { name: 'United Kingdom', minLat: 49.8, maxLat: 61.0, minLon: -8.6, maxLon: 2.0 },
  { name: 'Spain', minLat: 35.9, maxLat: 43.8, minLon: -9.3, maxLon: 4.3 },
  { name: 'Italy', minLat: 36.6, maxLat: 47.1, minLon: 6.6, maxLon: 18.5 },
  { name: 'Austria', minLat: 46.4, maxLat: 49.0, minLon: 9.5, maxLon: 17.2 },
  { name: 'Switzerland', minLat: 45.8, maxLat: 47.8, minLon: 5.9, maxLon: 10.5 },
  { name: 'Poland', minLat: 49.0, maxLat: 54.8, minLon: 14.1, maxLon: 24.2 },
  { name: 'Czech Republic', minLat: 48.5, maxLat: 51.1, minLon: 12.1, maxLon: 18.9 },
  { name: 'Hungary', minLat: 45.7, maxLat: 48.6, minLon: 16.1, maxLon: 22.9 },
  { name: 'Romania', minLat: 43.6, maxLat: 48.3, minLon: 20.3, maxLon: 30.0 },
  { name: 'Turkey', minLat: 35.8, maxLat: 42.1, minLon: 25.7, maxLon: 44.8 },
  { name: 'Greece', minLat: 34.8, maxLat: 42.0, minLon: 19.3, maxLon: 29.6 },
  { name: 'Russia', minLat: 41.2, maxLat: 82.0, minLon: 19.6, maxLon: 180.0 },
  { name: 'Ukraine', minLat: 44.4, maxLat: 52.4, minLon: 22.1, maxLon: 40.2 },
  { name: 'Kazakhstan', minLat: 40.6, maxLat: 55.4, minLon: 50.3, maxLon: 87.4 },
  { name: 'Iran', minLat: 25.1, maxLat: 39.8, minLon: 44.0, maxLon: 63.3 },
  { name: 'Iraq', minLat: 29.1, maxLat: 37.4, minLon: 38.8, maxLon: 48.6 },
  { name: 'Saudi Arabia', minLat: 16.4, maxLat: 32.2, minLon: 34.6, maxLon: 55.7 },
  { name: 'UAE', minLat: 22.6, maxLat: 26.1, minLon: 51.6, maxLon: 56.4 },
  { name: 'India', minLat: 8.1, maxLat: 37.1, minLon: 68.1, maxLon: 97.4 },
  { name: 'China', minLat: 18.2, maxLat: 53.6, minLon: 73.4, maxLon: 135.1 },
  { name: 'Japan', minLat: 24.0, maxLat: 45.5, minLon: 122.9, maxLon: 153.0 },
  { name: 'South Korea', minLat: 33.1, maxLat: 38.6, minLon: 124.6, maxLon: 130.9 },
  { name: 'United States', minLat: 24.4, maxLat: 49.4, minLon: -125.0, maxLon: -66.9 },
  { name: 'Canada', minLat: 41.7, maxLat: 83.1, minLon: -141.0, maxLon: -52.6 },
  { name: 'Greenland', minLat: 59.7, maxLat: 83.6, minLon: -73.0, maxLon: -11.3 },
  { name: 'Iceland', minLat: 63.2, maxLat: 66.6, minLon: -24.5, maxLon: -13.5 },
  { name: 'Norway', minLat: 57.9, maxLat: 71.2, minLon: 4.5, maxLon: 31.1 },
  { name: 'Sweden', minLat: 55.3, maxLat: 69.1, minLon: 10.6, maxLon: 24.2 },
  { name: 'Finland', minLat: 59.8, maxLat: 70.1, minLon: 19.1, maxLon: 31.6 },
  { name: 'Pakistan', minLat: 23.6, maxLat: 37.1, minLon: 60.9, maxLon: 77.8 },
  { name: 'Afghanistan', minLat: 29.4, maxLat: 38.5, minLon: 60.5, maxLon: 75.2 },
  { name: 'Egypt', minLat: 21.9, maxLat: 31.7, minLon: 24.7, maxLon: 37.1 },
  { name: 'Libya', minLat: 19.5, maxLat: 33.2, minLon: 9.4, maxLon: 25.2 },
  { name: 'Algeria', minLat: 18.9, maxLat: 37.1, minLon: -8.7, maxLon: 11.9 },
  { name: 'Morocco', minLat: 27.7, maxLat: 35.9, minLon: -13.2, maxLon: -0.9 },
  { name: 'Portugal', minLat: 36.8, maxLat: 42.2, minLon: -9.5, maxLon: -6.2 },
  { name: 'Netherlands', minLat: 50.8, maxLat: 53.5, minLon: 3.4, maxLon: 7.2 },
  { name: 'Belgium', minLat: 49.5, maxLat: 51.5, minLon: 2.5, maxLon: 6.4 },
  { name: 'Thailand', minLat: 5.6, maxLat: 20.5, minLon: 97.3, maxLon: 105.7 },
  { name: 'Singapore', minLat: 1.1, maxLat: 1.5, minLon: 103.6, maxLon: 104.4 },
  { name: 'Malaysia', minLat: 0.9, maxLat: 7.4, minLon: 99.6, maxLon: 119.3 },
  { name: 'Indonesia', minLat: -11.0, maxLat: 6.1, minLon: 94.8, maxLon: 141.0 },
  { name: 'Australia', minLat: -43.6, maxLat: -10.7, minLon: 113.1, maxLon: 153.6 },
  { name: 'New Zealand', minLat: -47.3, maxLat: -34.4, minLon: 166.4, maxLon: 178.6 },
  { name: 'Brazil', minLat: -33.8, maxLat: 5.3, minLon: -73.9, maxLon: -34.8 },
  { name: 'Mexico', minLat: 14.5, maxLat: 32.7, minLon: -117.1, maxLon: -86.7 },
  { name: 'South Africa', minLat: -34.8, maxLat: -22.1, minLon: 16.5, maxLon: 32.9 },
  { name: 'Ethiopia', minLat: 3.4, maxLat: 15.0, minLon: 33.0, maxLon: 48.0 },
];

/**
 * Estimate overflight countries by interpolating waypoints and checking bounding boxes.
 * Uses linear interpolation with 10 steps per segment for reasonable coverage.
 */
function estimateOverflownCountries(waypoints: { lat: number; lon: number }[]): string[] {
  const countries = new Set<string>();

  const interpolated: { lat: number; lon: number }[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      interpolated.push({
        lat: waypoints[i].lat + (waypoints[i + 1].lat - waypoints[i].lat) * t,
        lon: waypoints[i].lon + (waypoints[i + 1].lon - waypoints[i].lon) * t,
      });
    }
  }

  for (const point of interpolated) {
    for (const country of COUNTRY_BBOXES) {
      if (
        point.lat >= country.minLat &&
        point.lat <= country.maxLat &&
        point.lon >= country.minLon &&
        point.lon <= country.maxLon
      ) {
        countries.add(country.name);
      }
    }
  }

  return [...countries];
}

export interface EstimatedRoute {
  waypoints: Array<{lat: number; lon: number}>;
  overflownCountries: string[];
  routeDistance: number;
  estimationMethod: 'great_circle' | 'known_route' | 'polar_route' | 'southern_route';
  confidence: number;
}

/**
 * Estimate route for a flight
 */
export function estimateRoute(
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number,
  flightNumber: string,
  date: Date
): EstimatedRoute {
  // Check for known routes first
  const knownRoute = findKnownRoute(depLat, depLon, arrLat, arrLon, flightNumber);
  if (knownRoute) {
    return knownRoute;
  }

  // Check if this is a polar route (northern hemisphere, high latitude)
  if (depLat > 60 || arrLat > 60) {
    return estimatePolarRoute(depLat, depLon, arrLat, arrLon, date);
  }

  // Check if this route might have changed due to Russia airspace closure (after 2022)
  if (date.getFullYear() >= 2022 && mightNeedRussiaCircumvention(depLat, depLon, arrLat, arrLon)) {
    return estimateSouthernRoute(depLat, depLon, arrLat, arrLon);
  }

  // Fallback: Great Circle
  return estimateGreatCircleRoute(depLat, depLon, arrLat, arrLon);
}

/**
 * Estimate Great Circle route (direct path)
 */
function estimateGreatCircleRoute(
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number
): EstimatedRoute {
  // Simple Great Circle: just start and end points
  const waypoints = [
    { lat: depLat, lon: depLon },
    { lat: arrLat, lon: arrLon },
  ];

  const routeDistance = calculateDistance(depLat, depLon, arrLat, arrLon);

  const overflownCountries = estimateOverflownCountries(waypoints);

  return {
    waypoints,
    overflownCountries,
    routeDistance,
    estimationMethod: 'great_circle',
    confidence: 30,
  };
}

/**
 * Estimate polar route (over Arctic)
 */
function estimatePolarRoute(
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number,
  date: Date
): EstimatedRoute {
  // Polar route typically goes over Greenland or northern Canada
  const midLat = Math.max(depLat, arrLat) + 10; // Go further north
  const midLon = (depLon + arrLon) / 2;

  // Add waypoint over Greenland/Arctic
  const waypoints = [
    { lat: depLat, lon: depLon },
    { lat: midLat, lon: midLon },
    { lat: arrLat, lon: arrLon },
  ];

  // Calculate distance (simplified)
  const dist1 = calculateDistance(depLat, depLon, midLat, midLon);
  const dist2 = calculateDistance(midLat, midLon, arrLat, arrLon);
  const routeDistance = dist1 + dist2;

  const overflownCountries = estimateOverflownCountries(waypoints);

  return {
    waypoints,
    overflownCountries,
    routeDistance,
    estimationMethod: 'polar_route',
    confidence: 50,
  };
}

/**
 * Estimate southern route (circumventing Russia)
 */
function estimateSouthernRoute(
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number
): EstimatedRoute {
  // Route goes south, avoiding Russia
  // Typical waypoints: Turkey, Iran, Central Asia
  const midLat = Math.min(depLat, arrLat) - 5; // Go south
  const midLon = (depLon + arrLon) / 2;

  const waypoints = [
    { lat: depLat, lon: depLon },
    { lat: midLat, lon: midLon },
    { lat: arrLat, lon: arrLon },
  ];

  const dist1 = calculateDistance(depLat, depLon, midLat, midLon);
  const dist2 = calculateDistance(midLat, midLon, arrLat, arrLon);
  const routeDistance = dist1 + dist2;

  const overflownCountries = estimateOverflownCountries(waypoints);

  return {
    waypoints,
    overflownCountries,
    routeDistance,
    estimationMethod: 'southern_route',
    confidence: 70,
  };
}

/**
 * Check if route might need Russia circumvention
 */
function mightNeedRussiaCircumvention(
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number
): boolean {
  // Very simplified check: if route goes through high latitudes in Europe/Asia region
  const avgLat = (depLat + arrLat) / 2;
  const avgLon = (depLon + arrLon) / 2;

  // Check if route is in Europe-Asia region and might cross Russia
  return avgLat > 40 && avgLat < 70 && avgLon > 0 && avgLon < 180;
}

/**
 * Find known route from database
 */
function findKnownRoute(
  depLat: number,
  depLon: number,
  arrLat: number,
  arrLon: number,
  flightNumber: string
): EstimatedRoute | null {
  // Known routes could be loaded from a database or config file.
  // Currently returns null; route estimation falls through to geometric estimation.
  return null;
}
