/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of point 1
 * @param lon1 Longitude of point 1
 * @param lat2 Latitude of point 2
 * @param lon2 Longitude of point 2
 * @returns Distance in kilometers
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
};

const toRad = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};

/**
 * Generate points along a great circle arc for map visualization
 * Handles antimeridian (dateline) crossing correctly
 * @param start Starting coordinates [lon, lat]
 * @param end Ending coordinates [lon, lat]
 * @param numPoints Number of intermediate points
 * @returns Array of [lon, lat] coordinates
 */
export const generateArcPoints = (
  start: [number, number],
  end: [number, number],
  numPoints: number = 50
): [number, number][] => {
  const points: [number, number][] = [];
  let [lon1, lat1] = start;
  let [lon2, lat2] = end;

  // Handle antimeridian crossing
  // If the difference is greater than 180°, we should cross the dateline
  let lonDiff = lon2 - lon1;

  if (lonDiff > 180) {
    lon1 += 360;
  } else if (lonDiff < -180) {
    lon2 += 360;
  }

  for (let i = 0; i <= numPoints; i++) {
    const fraction = i / numPoints;
    const point = interpolateGreatCircle(lat1, lon1, lat2, lon2, fraction);

    // Normalize longitude to -180 to 180 range
    let normalizedLon = point.lon;
    while (normalizedLon > 180) normalizedLon -= 360;
    while (normalizedLon < -180) normalizedLon += 360;

    points.push([normalizedLon, point.lat]);
  }

  return points;
};

const interpolateGreatCircle = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  fraction: number
): { lat: number; lon: number } => {
  const lat1Rad = toRad(lat1);
  const lon1Rad = toRad(lon1);
  const lat2Rad = toRad(lat2);
  const lon2Rad = toRad(lon2);

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.pow(Math.sin((lat1Rad - lat2Rad) / 2), 2) +
        Math.cos(lat1Rad) *
          Math.cos(lat2Rad) *
          Math.pow(Math.sin((lon1Rad - lon2Rad) / 2), 2)
    )
  );

  // Guard: identical points — return departure point
  if (Math.abs(d) < 1e-10) {
    return { lat: lat1, lon: lon1 };
  }

  // Guard: antipodal points (d ≈ π) — great-circle is undefined, fall back to linear interpolation
  if (Math.abs(d - Math.PI) < 1e-10) {
    return {
      lat: lat1 + (lat2 - lat1) * fraction,
      lon: lon1 + (lon2 - lon1) * fraction,
    };
  }

  const a = Math.sin((1 - fraction) * d) / Math.sin(d);
  const b = Math.sin(fraction * d) / Math.sin(d);

  const x = a * Math.cos(lat1Rad) * Math.cos(lon1Rad) + b * Math.cos(lat2Rad) * Math.cos(lon2Rad);
  const y = a * Math.cos(lat1Rad) * Math.sin(lon1Rad) + b * Math.cos(lat2Rad) * Math.sin(lon2Rad);
  const z = a * Math.sin(lat1Rad) + b * Math.sin(lat2Rad);

  const latRad = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lonRad = Math.atan2(y, x);

  return {
    lat: latRad * (180 / Math.PI),
    lon: lonRad * (180 / Math.PI),
  };
};
