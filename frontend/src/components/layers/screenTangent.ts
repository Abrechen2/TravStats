// The one place an icon's rotation is worked out.
//
// deck.gl's `getAngle` rotates in SCREEN space. The screen is Web Mercator,
// where a degree of latitude is worth `1/cos(lat)` degrees of longitude — so
// an angle taken from raw lon/lat deltas is the angle on a plate carrée map
// nobody is looking at. Two layers did exactly that:
//
//   - `cruiseArcsLayer`'s direction arrows. Measured: Barcelona →
//     Civitavecchia came out at 4.28° where the line is drawn at 5.72° — 1.4°
//     out, which is why the browser check in #160 passed and the bug survived
//     it. Reykjavík → Longyearbyen is 20.53° against 50.64°, thirty degrees
//     out, and that is what a high-latitude cruise was showing.
//   - `tripsLayer`'s aeroplane. Measured on LPA→YVR at five points along the
//     track: 5.4° / 8.3° / 8.3° / 2.7° / 8.4° out.
//
// It is the same class of defect as a route drawn as a Mercator chord, one
// level down: geography computed in one space and rendered in another. The
// unit tests of both layers were green throughout, because the expectation
// was derived the same wrong way — `screenTangent.test.ts` measures against
// `MercatorCoordinate.fromLngLat`, maplibre-gl's own projection, which can
// disagree with this file.
//
// What does NOT change: a due-east leg has no y component and a due-north one
// no x component, so neither can be moved by a stretch in y. The 0 = east,
// −90 = south convention #160 pinned in a browser still holds exactly.

/**
 * Latitude in Web Mercator's y, in the same units as a degree of longitude —
 * i.e. the "Mercator latitude". This is the projection deck.gl's
 * `project_position` applies to a LNGLAT layer, and the one MapLibre draws
 * the basemap in.
 *
 * Clamped at ±89.9°: unclamped, the formula is −Infinity at lat −90 (log of
 * zero), and two such vertices then differ by NaN, which rotates an icon to
 * nowhere. No renderer can tell ±89.9 from ±90 apart.
 */
const POLE_LIMIT_DEG = 89.9;

export function mercatorY(latDeg: number): number {
  const lat = Math.max(-POLE_LIMIT_DEG, Math.min(POLE_LIMIT_DEG, latDeg));
  return (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
}

/**
 * The on-screen direction of the segment `from` → `to`, in deck.gl's icon
 * rotation convention: degrees, y-up, 0 = east, positive counterclockwise.
 *
 * A zero-length segment returns 0 rather than null; callers that care about
 * the difference (an arrow with nowhere to point) test the segment themselves
 * before asking.
 */
export function screenTangentDeg(
  from: readonly [number, number],
  to: readonly [number, number]
): number {
  const dx = to[0] - from[0];
  const dy = mercatorY(to[1]) - mercatorY(from[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}
