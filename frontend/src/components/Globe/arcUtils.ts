// Pure arc-geometry helpers extracted from GlobeView. Stateless, no
// closures, side-effect free — safe to import from anywhere.
//
// The geodesic and altitude maths drive both the per-route aggregated
// arcs and the single "head flight" arc. Constants are tuned for the
// MapLibre globe projection + deck.gl PathLayer combination — see the
// long-form rationale on each declaration.

export const EARTH_RADIUS_M = 6_371_000;

// Peak altitude (meters above ellipsoid) for a flight arc with the
// given great-circle distance.
//
// Industry standard on 3D globes (vasturiano/globe.gl, Cesium,
// Mapbox examples) is to scale altitude with distance, not with
// earth-radius staircase: short hops barely lift, long hauls bow
// modestly. Our previous radius-staircase peaked at 0.45 R ≈ 2 870
// km for long-haul, which towered above the globe and created the
// "Saturn ring" look the user reported.
//
// Formula: 12 % of great-circle distance, capped at 15 % of earth
// radius. Yields:
//
//   500 km   →   60 km peak
//   2 500 km →  300 km
//   8 000 km →  960 km
//  15 000 km → 1 800 km
//  ≥19 800 km caller skips (antipodal — degenerate great-circle)
export const ARC_ALTITUDE_FRACTION = 0.12;
export const ARC_ALTITUDE_CAP_M = EARTH_RADIUS_M * 0.15;

// Distance threshold above which a city pair is "near-antipodal" and
// its great circle is degenerate (infinitely many shortest paths
// through both poles). deck.gl/three.js arc tessellation in this
// regime produces a visible "ring around the pole" — the SYD↔TFS
// artifact the user reported. Earth half-circumference is ~20 015
// km; 19 800 km gives a ~1° antipodal exclusion zone.
export const ANTIPODAL_DISTANCE_KM = 19_800;

export const getArcPeakAltitudeMeters = (distanceKm: number): number =>
  Math.min(distanceKm * 1000 * ARC_ALTITUDE_FRACTION, ARC_ALTITUDE_CAP_M);

// Vertex count for the great-circle slerp. Fixed 48 was wasteful for
// short hops (a 300 km flight needs maybe 10 segments to look smooth)
// and barely enough for long-haul (12 000 km routes show visible
// polygonal kinks at 48). Scaling cuts total vertex count roughly in
// half on a typical mixed dataset, which matters on mobile / slow GPUs
// where ColumnLayer + PathLayer + base map already saturate the
// fragment-shader budget.
//
//   500 km   →  10 (clamped to 12)
//   2 500 km →  16
//   6 000 km →  28
//  12 000 km →  48
//  18 000 km →  64 (clamped)
export const ARC_STEPS_MIN = 12;
export const ARC_STEPS_MAX = 64;
export const ARC_STEPS_LITE = 16;

export const getArcSteps = (distanceKm: number, lite: boolean): number =>
  lite
    ? ARC_STEPS_LITE
    : Math.min(ARC_STEPS_MAX, Math.max(ARC_STEPS_MIN, Math.round(distanceKm / 300) + 8));

// Auto-suggest performance mode when the visible payload crosses these
// thresholds. Tuned against the 160-flight + 22-cruise demo seed (which
// runs comfortably without lite) and field reports of jank around the
// 200-arc / 100-cruise mark on integrated GPUs.
export const LITE_AUTO_ARC_THRESHOLD = 200;
export const LITE_AUTO_CRUISE_THRESHOLD = 100;

// Haversine distance in km for fly-to-arc zoom heuristic.
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Great-circle slerp between two [lng, lat] points with a parabolic
 * z-altitude profile, returning N+1 [lng, lat, altitudeMeters]
 * waypoints along the geodesic. Altitude peaks at the midpoint and
 * tapers to zero at the endpoints — gives the classic Flightradar /
 * three.js-GlobeView arc bow.
 *
 * Why we need this: deck.gl ArcLayer with `greatCircle: true` computes
 * arc height in screen-space, which collapses to zero on MapLibre's
 * globe projection (arcs become invisible). PathLayer with
 * pre-tessellated 3D waypoints renders the curve through MapLibre's
 * regular line pipeline, and the z-coordinate is honoured radially in
 * globe projection — the path bows outward from the sphere.
 *
 * Math: convert each endpoint to a unit Cartesian vector, slerp by
 * `t = i / steps`, project back to spherical, apply z = peak·sin(πt).
 * Long-way-around is suppressed by unwrapping the longitude difference
 * into [-π, π] before slerping.
 */
export const greatCircleWaypoints = (
  from: [number, number],
  to: [number, number],
  peakAltitudeM: number,
  steps = 48
): [number, number, number][] => {
  const toRad = (x: number): number => (x * Math.PI) / 180;
  const toDeg = (x: number): number => (x * 180) / Math.PI;
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lam1 = toRad(lng1);
  let lam2 = toRad(lng2);
  const lamDiff = lam2 - lam1;
  if (lamDiff > Math.PI) lam2 -= 2 * Math.PI;
  else if (lamDiff < -Math.PI) lam2 += 2 * Math.PI;

  const dPhi = phi2 - phi1;
  const dLam = lam2 - lam1;
  const aH = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(Math.max(0, 1 - aH)));
  if (c < 1e-9)
    return [
      [lng1, lat1, 0],
      [lng2, lat2, 0],
    ];

  const sinC = Math.sin(c);
  const out: [number, number, number][] = [];
  // Continuous-longitude unwrapping: atan2 always returns lng in
  // (-180, 180], so a great circle that crosses the antimeridian would
  // emit a 360° jump between consecutive samples (e.g. 179 → -179).
  // PathLayer interprets that jump as "wrap around the whole globe"
  // and renders a phantom polyline circling the planet — the ghost
  // arcs the user reported. We unwrap each sample to stay within ±180
  // of the previous one so the polyline is mathematically monotone.
  // MapLibre globe projection accepts lng > 180 / < -180 (it's the
  // same point on the sphere), so the visible arc lands exactly where
  // it should. Pair this with `wrapLongitude: false` on PathLayer.
  let prevLng = lng1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const A = Math.sin((1 - t) * c) / sinC;
    const B = Math.sin(t * c) / sinC;
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    let lng = toDeg(Math.atan2(y, x));
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    const altitude = peakAltitudeM * Math.sin(Math.PI * t);
    out.push([lng, lat, altitude]);
  }
  return out;
};

export const createRouteKey = (a: string, b: string): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Build a stable per-endpoint identity string. Prefers IATA, falls back
 * to rounded lat,lng (~11 km grid at the equator). Falling back to a
 * single sentinel like "UNK" would collapse every IATA-less flight into
 * one bucket and draw a single phantom mega-arc spanning whichever two
 * arbitrary endpoints happened to land first — exactly the bug Codex
 * spotted in this file.
 */
export const endpointIdentity = (iata: string | undefined, lng: number, lat: number): string =>
  iata ?? `@${lng.toFixed(1)},${lat.toFixed(1)}`;
