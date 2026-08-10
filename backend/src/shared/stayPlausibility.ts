/**
 * Cross-domain sanity check (#6): does a stay's location have any trip leg
 * arriving near it? A hotel in Tokyo on a trip whose only flights land in New
 * York is almost certainly an import or typo error — the domains carry the
 * coordinates to notice, but nothing correlated them.
 *
 * Deliberately a SOFT hint, and deliberately generous: airports sit far from
 * the cities they serve (Narita is ~60 km from central Tokyo), so the radius
 * must clear that without waving through a genuinely wrong location.
 *
 * Mirror of frontend/src/shared/stayPlausibility.ts — keep both in sync.
 */
export const STAY_NEAR_LEG_KM = 200;

export interface Point {
  lat: number | null | undefined;
  lon: number | null | undefined;
}

export interface StayPlausibility {
  /** Distance to the closest trip leg, or null when it cannot be judged. */
  nearestKm: number | null;
  /** false only when there IS a leg to compare against and none is near. */
  plausible: boolean;
}

function isPoint(p: Point): p is { lat: number; lon: number } {
  return typeof p.lat === "number" && typeof p.lon === "number";
}

/** Great-circle distance in km. Inlined so this mirrored file has no
 *  dependency (backend and frontend keep their geo primitives elsewhere). */
function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * @param stay   the lodging's own coordinates
 * @param legs   arrival/port coordinates of the trip's flights and cruises
 *
 * Returns plausible=true (nothing to flag) whenever the stay has no
 * coordinates, or the trip has no located legs at all — a hotel-only trip is
 * legitimate and must never warn. It warns only when there are legs and the
 * closest is beyond the radius.
 */
export function assessStayPlausibility(stay: Point, legs: Point[]): StayPlausibility {
  if (!isPoint(stay)) return { nearestKm: null, plausible: true };
  const located = legs.filter(isPoint);
  if (located.length === 0) return { nearestKm: null, plausible: true };

  let nearestKm = Infinity;
  for (const leg of located) {
    const d = haversineKm(stay, leg);
    if (d < nearestKm) nearestKm = d;
  }
  return { nearestKm, plausible: nearestKm <= STAY_NEAR_LEG_KM };
}
