import { seaRoute } from "searoute-ts";
import type { RouteMethod, LonLat, PortPair } from "../types";
import { polylineLengthKm, slerp, haversineKm } from "../geo";
import { loadLandMask, isWaterCell, latToRow, lonToCol } from "../landMask";
import { bezierMethod } from "./bezier";

/**
 * Sample the great-circle between `a` and `b` at `samples` points and
 * return how many of them fall on a land cell per the 0.1° mask.
 * 0 = safe open-water route, small counts = coast-grazing, high =
 * route crosses continents (use a real router).
 */
async function countLandSamplesOnGreatCircle(
  a: LonLat,
  b: LonLat,
  samples: number,
): Promise<number> {
  const mask = await loadLandMask(0.1);
  let hits = 0;
  // Ignore the endpoints themselves — ports are often on cells the
  // raster calls land even though the harbour is water (Hamburg, Antwerp).
  for (let i = 1; i < samples; i++) {
    const p = slerp(a, b, i / samples);
    const row = latToRow(p[1], mask);
    const col = lonToCol(p[0], mask);
    if (!isWaterCell(row, col, mask)) hits++;
  }
  return hits;
}

/**
 * Run searoute-ts inside a `Feature<Point>` wrapper. Returns the
 * coordinates and the library's own distance report, or `null` if
 * searoute-ts couldn't route.
 */
function runSearoute(pair: PortPair): { coords: LonLat[]; km: number } | null {
  const origin = {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [pair.from.lon, pair.from.lat] },
  };
  const destination = {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [pair.to.lon, pair.to.lat] },
  };
  try {
    const feature = seaRoute(origin, destination, "kilometers");
    const coords = (feature.geometry.coordinates as number[][]).map(
      ([lon, lat]) => [lon, lat] as LonLat,
    );
    const km =
      typeof feature.properties?.length === "number"
        ? (feature.properties.length as number)
        : polylineLengthKm(coords);
    return { coords, km };
  } catch {
    return null;
  }
}

/**
 * Build a great-circle polyline from a to b at `samples` points, then
 * prepend a and append b so the line visibly starts / ends at the
 * port markers (no gap).
 */
function greatCircle(a: LonLat, b: LonLat, samples: number): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i <= samples; i++) out.push(slerp(a, b, i / samples));
  return out;
}

/**
 * Detect the sparse-graph "backtrack" pathology by checking whether
 * the first few vertices are MOVING AWAY from the destination. That's
 * the signature of the Miami↔Nassau bug: the route climbs 100 km up
 * the Florida coast before turning south-east, and for each of those
 * vertices the distance-to-Nassau grows instead of shrinking.
 *
 * We compare to bearings instead of distances in the previous version
 * of this guard, but a bearing-based test mistakenly flagged
 * Rotterdam↔Singapore — the great-circle chord there goes over the
 * pole, so every real shipping route's initial bearing differs from
 * the chord by ~120° and that's completely healthy.
 *
 * Heuristic: if the distance-to-destination of the first few vertices
 * increases beyond 10% of the great-circle chord length, we call it
 * a backtrack. Tiny initial hops that shouldn't matter (e.g.
 * Rotterdam → Dover adds maybe 0.5 % of the chord) stay under the
 * threshold.
 */
function hasLocalBacktrack(route: LonLat[], from: LonLat, to: LonLat): boolean {
  if (route.length < 4) return false;
  const chord = haversineKm(from, to);
  const budget = chord * 0.1;
  // Head: walk forward up to `lookAhead` vertices; if any of them is
  // more than `budget` farther from `to` than the start, flag.
  const LOOKAHEAD = Math.min(5, Math.max(2, Math.floor(route.length / 4)));
  const startToDest = haversineKm(route[0], to);
  for (let i = 1; i <= LOOKAHEAD; i++) {
    const d = haversineKm(route[i], to);
    if (d - startToDest > budget) return true;
  }
  // Tail: walk backward. Last vertex is closest; flag if any of the
  // final few are more than `budget` farther from `from` than the
  // actual arrival.
  const tail = route.length - 1;
  const endToOrigin = haversineKm(route[tail], from);
  for (let i = 1; i <= LOOKAHEAD; i++) {
    const d = haversineKm(route[tail - i], from);
    if (d - endToOrigin > budget) return true;
  }
  return false;
}

/**
 * Hybrid method:
 *   1. Great-circle-safe test — sample the geodesic at 50 points against
 *      the 0.1° land mask. If NONE are on land, use great-circle. It's
 *      shorter, cleaner, and searoute-ts detours unnecessarily over
 *      empty ocean (Sydney→Auckland loses 11% to a graph detour).
 *   2. Otherwise call searoute-ts. Accept its output UNLESS its first
 *      or last few segments point away from the chord by >120° — that
 *      signals a sparse-graph backtrack (Miami→Nassau gets snapped up
 *      to Jupiter FL before heading south-east, even though a 300 km
 *      direct shot exists). Distance ratios don't catch this reliably
 *      because real intercontinental detours via Suez / Panama / Cape
 *      of Good Hope are 40-70% longer than the chord but perfectly
 *      correct.
 *   3. On pathological backtrack or a null return, fall back to the
 *      Bezier curve — not geographically right, but at least smooth
 *      and directionally sane.
 */
export const hybridMethod: RouteMethod = {
  id: "hybrid",
  label: "Hybrid (searoute-ts + GC + bearing guard)",
  color: "#c084fc",
  description:
    "Great-circle when open ocean, searoute-ts otherwise, Bezier fallback when searoute backtracks.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const from: LonLat = [pair.from.lon, pair.from.lat];
    const to: LonLat = [pair.to.lon, pair.to.lat];
    const gcDistance = haversineKm(from, to);

    // 1. Open-ocean short-circuit.
    const SAMPLES = 50;
    const landHits = await countLandSamplesOnGreatCircle(from, to, SAMPLES);
    if (landHits === 0) {
      const coords = greatCircle(from, to, 64);
      return {
        coordinates: coords,
        distanceKm: polylineLengthKm(coords),
        computeMs: performance.now() - t0,
        note: "open-ocean — great-circle",
      };
    }

    // 2. searoute-ts + bearing guard.
    const sr = runSearoute(pair);
    if (sr && !hasLocalBacktrack(sr.coords, from, to)) {
      return {
        coordinates: sr.coords,
        distanceKm: sr.km,
        computeMs: performance.now() - t0,
        note: `searoute-ts (${landHits}/${SAMPLES} land samples, ratio ${(
          sr.km / gcDistance
        ).toFixed(2)}×)`,
      };
    }

    // 3. Backtrack or null — Bezier fallback.
    const bezier = await bezierMethod.compute(pair);
    return {
      ...bezier,
      computeMs: performance.now() - t0,
      note:
        sr === null
          ? "searoute null — bezier fallback"
          : "searoute backtracks — bezier fallback",
    };
  },
};
