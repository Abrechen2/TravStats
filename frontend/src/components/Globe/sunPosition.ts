/**
 * Day/night terminator geometry for the globe.
 *
 * Pure, stateless helpers (same convention as arcUtils/heatmapUtils): given a
 * timestamp, compute where the sun is overhead and the great-circle boundary
 * between the lit and dark hemispheres. Used to draw a subtle night-side shade
 * and a soft twilight line on the 3D globe.
 *
 * The solar position uses the NOAA "fractional year" approximation for
 * declination + equation of time — accurate to well under a degree, which is
 * far finer than a globe view needs.
 */

const DEG = Math.PI / 180;

export interface SubsolarPoint {
  /** Latitude where the sun is directly overhead (= solar declination), degrees. */
  lat: number;
  /** Longitude where it is local solar noon, degrees [-180, 180]. */
  lon: number;
  /** Solar declination in radians (kept for the terminator formula). */
  declRad: number;
}

/** The point on Earth's surface directly beneath the sun at `date` (UTC). */
export function subsolarPoint(date: Date): SubsolarPoint {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86_400_000;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Fractional year (radians).
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  // Equation of time (minutes) and declination (radians) — NOAA series.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declRad =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  // Longitude of the subsolar meridian: where local apparent solar time = noon.
  let lon = -15 * (utcHours + eqTime / 60 - 12);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;

  return { lat: declRad / DEG, lon, declRad };
}

/**
 * Latitude of the terminator (sun on the horizon) at a given longitude.
 * Derived from the solar-elevation-zero condition on a sphere.
 */
function terminatorLat(lonDeg: number, sun: SubsolarPoint): number {
  const hourAngle = (lonDeg - sun.lon) * DEG;
  // Guard the equinox singularity (decl ≈ 0 → terminator is a meridian pair).
  const tanDecl = Math.tan(sun.declRad);
  if (Math.abs(tanDecl) < 1e-6) return 0;
  return Math.atan(-Math.cos(hourAngle) / tanDecl) / DEG;
}

/** Longitude/latitude ring tracing the day/night boundary (great circle). */
export function terminatorLine(date: Date, stepDeg = 2): [number, number][] {
  const sun = subsolarPoint(date);
  const ring: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    ring.push([lon, terminatorLat(lon, sun)]);
  }
  return ring;
}

/** Sine of the sun's elevation angle at a surface point (for night testing). */
function solarElevationSin(lonDeg: number, latDeg: number, sun: SubsolarPoint): number {
  const lat = latDeg * DEG;
  const hourAngle = (lonDeg - sun.lon) * DEG;
  return (
    Math.sin(lat) * Math.sin(sun.declRad) +
    Math.cos(lat) * Math.cos(sun.declRad) * Math.cos(hourAngle)
  );
}

export interface NightCell {
  /** Small quad on the sphere surface, deck.gl polygon form. */
  polygon: [number, number][];
  /** 0 at the terminator → 1 past astronomical twilight (drives the shade alpha). */
  shade: number;
}

/**
 * The night hemisphere as a fine grid of small quads. A single hemisphere
 * polygon would tessellate into large flat triangles that sink through the
 * globe (same z-fighting the cruise paths avoid with altitude); many small
 * cells hug the curved surface cleanly. Each cell whose centre is below the
 * horizon is emitted, with a soft twilight `shade` from the terminator inward.
 */
export function nightCells(date: Date, gridDeg = 2.5, twilightDeg = 18): NightCell[] {
  const sun = subsolarPoint(date);
  const half = gridDeg / 2;
  const cells: NightCell[] = [];
  for (let lat = -90 + half; lat < 90; lat += gridDeg) {
    for (let lon = -180 + half; lon < 180; lon += gridDeg) {
      const elevDeg = Math.asin(solarElevationSin(lon, lat, sun)) / DEG;
      if (elevDeg >= 0) continue; // daylight
      const shade = Math.min(1, -elevDeg / twilightDeg);
      cells.push({
        polygon: [
          [lon - half, lat - half],
          [lon + half, lat - half],
          [lon + half, lat + half],
          [lon - half, lat + half],
        ],
        shade,
      });
    }
  }
  return cells;
}
