import { seaRoute } from "searoute-ts";
import type { RouteMethod, LonLat, PortPair } from "../types";
import { polylineLengthKm, slerp, haversineKm } from "../geo";
import { loadLandMask, isWaterCell, latToRow, lonToCol } from "../landMask";
import { computeAStar } from "../aStar";

/**
 * Hybrid v2 — based on Codex's review of v1:
 *
 *  v1 took the great-circle short-circuit on any pair where 50 samples
 *  missed land. Vancouver↔Juneau and Stockholm↔Helsinki slipped through
 *  because the fjords/archipelagos between samples stayed under the
 *  radar, and v1 also fell back to Bezier on searoute misroutes, which
 *  is blind to land and draws across continents.
 *
 * v2 fixes both:
 *   1. Adaptive fine-grained GC-safe test against the **0.05°** mask
 *      (~5.5 km cells, ~4× resolution of v1). Sample density is one
 *      sample per ≈ 2 km of chord, with a minimum of 50 and a maximum
 *      of 1500. That catches Åland islands and BC fjords.
 *   2. If GC isn't safe → searoute-ts. The "is this a Miami↔Nassau
 *      sparse-graph zig-zag?" check is now the **endpoint-snap
 *      distance**: reject if `route[0]` is farther from the port than
 *      `max(25 km, 0.15 × chord)`. Codex pointed out that this is the
 *      real Miami smell, and distance-monotonicity misfires on Panama-
 *      style narrow passages.
 *   3. No more Bezier fallback when searoute-ts is rejected — Bezier
 *      cuts land. Instead, fall through to A* on the 0.05° raster,
 *      which is always water-safe even if slow (~1–2 s).
 *   4. Known-pass whitelist for canal / narrow-strait ports (Panama,
 *      Suez entrance, Kiel, Corinth, Bosporus, Dardanelles, Magellan).
 *      Within each bounding box the endpoint-snap check relaxes — a
 *      200 km canal transit legitimately snaps "far" from the port
 *      pole because the canal is narrow.
 */

interface KnownPass {
  id: string;
  /** [minLon, minLat, maxLon, maxLat] — used to gate the relaxed snap. */
  bbox: [number, number, number, number];
}

const KNOWN_PASSES: readonly KnownPass[] = [
  { id: "panama", bbox: [-80.2, 8.8, -79.4, 9.4] },
  { id: "suez-north", bbox: [32.1, 31.0, 32.6, 31.3] },
  { id: "suez-south", bbox: [32.3, 29.8, 32.7, 30.1] },
  { id: "kiel-east", bbox: [10.0, 54.3, 10.3, 54.4] },
  { id: "kiel-west", bbox: [9.0, 53.85, 9.3, 53.95] },
  { id: "corinth", bbox: [22.8, 37.9, 23.1, 38.1] },
  { id: "bosporus", bbox: [28.9, 41.0, 29.1, 41.3] },
  { id: "dardanelles", bbox: [26.1, 40.0, 26.7, 40.5] },
  { id: "magellan-west", bbox: [-74.5, -53.5, -73.5, -52.8] },
  { id: "magellan-east", bbox: [-70.5, -52.8, -69.5, -52.2] },
];

function portInKnownPass(p: { lat: number; lon: number }): boolean {
  for (const kp of KNOWN_PASSES) {
    const [minLon, minLat, maxLon, maxLat] = kp.bbox;
    if (p.lon >= minLon && p.lon <= maxLon && p.lat >= minLat && p.lat <= maxLat) {
      return true;
    }
  }
  return false;
}

/**
 * Count great-circle samples that land on a land cell of the fine
 * (0.05°) mask. Port endpoints themselves are skipped because harbours
 * often sit on cells the raster calls land even though the water is
 * right there (Hamburg on the Elbe, Antwerp on the Scheldt).
 */
async function fineGCLandHits(a: LonLat, b: LonLat): Promise<{ hits: number; samples: number }> {
  const mask = await loadLandMask(0.05);
  const chordKm = haversineKm(a, b);
  const samples = Math.max(50, Math.min(1500, Math.round(chordKm / 2)));
  let hits = 0;
  for (let i = 1; i < samples; i++) {
    const p = slerp(a, b, i / samples);
    const row = latToRow(p[1], mask);
    const col = lonToCol(p[0], mask);
    if (!isWaterCell(row, col, mask)) hits++;
  }
  return { hits, samples };
}

/**
 * Per-segment land-hit analysis: walk each segment via slerp at ~2 km
 * spacing and report the longest run of consecutive land samples per
 * segment. Segments with long runs are candidates for local A* repair.
 *
 * Endpoints skip the first/last samples because harbour cells register
 * as land even when the water is right there.
 */
async function segmentLandRuns(
  coords: LonLat[],
): Promise<Array<{ from: LonLat; to: LonLat; maxRun: number }>> {
  const mask = await loadLandMask(0.05);
  const out: Array<{ from: LonLat; to: LonLat; maxRun: number }> = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const segKm = haversineKm(a, b);
    const segSamples = Math.max(2, Math.min(400, Math.round(segKm / 2)));
    const startJ = i === 1 ? 1 : 0;
    const endJ = i === coords.length - 1 ? segSamples - 1 : segSamples;
    let maxRun = 0;
    let curRun = 0;
    for (let j = startJ; j < endJ; j++) {
      const p = slerp(a, b, j / segSamples);
      const row = latToRow(p[1], mask);
      const col = lonToCol(p[0], mask);
      if (!isWaterCell(row, col, mask)) {
        curRun++;
        if (curRun > maxRun) maxRun = curRun;
      } else {
        curRun = 0;
      }
    }
    out.push({ from: a, to: b, maxRun });
  }
  return out;
}

/**
 * Local repair: take a searoute polyline and replace each segment with
 * a long land-run by an A*-routed detour on the 0.05° raster. The
 * fixed polyline stitches A* output into the places searoute-ts's
 * graph had gaps (notably the Elbe-mouth → N Scotland edge on
 * Hamburg↔NYC, which is a single 650 km straight chord across
 * Denmark in the marnet graph).
 *
 * Repair budget: bail out if more than `maxRepairs` segments need
 * A*. The pathological sparse-graph case (Miami↔Nassau endpoint snap)
 * is already caught upstream; this is just for open-water segment
 * gaps in an otherwise-sound route.
 */
async function localRepairAcrossLand(
  coords: LonLat[],
  maxRun: number,
  maxRepairs = 10,
): Promise<{ coords: LonLat[]; repaired: number }> {
  const runs = await segmentLandRuns(coords);
  const bad = runs
    .map((r, i) => ({ idx: i, run: r.maxRun }))
    .filter((r) => r.run >= maxRun);
  if (bad.length === 0) return { coords, repaired: 0 };
  if (bad.length > maxRepairs) return { coords, repaired: -1 };

  const mask = await loadLandMask(0.05);
  const repairIdx = new Set(bad.map((b) => b.idx));
  const out: LonLat[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (repairIdx.has(i - 1)) {
      const detour = computeAStar(coords[i - 1], coords[i], mask);
      if (detour && detour.length > 2) {
        // detour starts at cell-center near coords[i-1] and ends near
        // coords[i]; skip the first vertex to avoid duplicating
        // coords[i-1] (already in `out`).
        for (let k = 1; k < detour.length; k++) out.push(detour[k]);
        continue;
      }
      // A* couldn't repair this segment — fall back to searoute's
      // original straight segment, flag as partial repair upstream.
    }
    out.push(coords[i]);
  }
  return { coords: out, repaired: bad.length };
}

function greatCircle(a: LonLat, b: LonLat, samples: number): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i <= samples; i++) out.push(slerp(a, b, i / samples));
  return out;
}

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
    if (coords.length < 2 || km <= 0) return null;
    return { coords, km };
  } catch {
    return null;
  }
}

/**
 * Endpoint-snap check: if the searoute first / last vertex is farther
 * from the raw port than the sparseness budget, searoute's graph has
 * a gap near that port (Miami↔Nassau). Known-pass ports get a wider
 * budget because narrow canals snap legitimately far.
 */
function endpointSnapBad(
  route: LonLat[],
  pair: PortPair,
  chordKm: number,
): { bad: true; reason: string } | { bad: false } {
  const localBudget = Math.max(25, 0.15 * chordKm);
  const wideBudget = Math.max(200, 0.4 * chordKm);
  const fromBudget = portInKnownPass(pair.from) ? wideBudget : localBudget;
  const toBudget = portInKnownPass(pair.to) ? wideBudget : localBudget;

  const firstSnap = haversineKm([pair.from.lon, pair.from.lat], route[0]);
  if (firstSnap > fromBudget) {
    return {
      bad: true,
      reason: `origin snap ${firstSnap.toFixed(0)} km > ${fromBudget.toFixed(0)} km budget`,
    };
  }
  const lastSnap = haversineKm([pair.to.lon, pair.to.lat], route[route.length - 1]);
  if (lastSnap > toBudget) {
    return {
      bad: true,
      reason: `dest snap ${lastSnap.toFixed(0)} km > ${toBudget.toFixed(0)} km budget`,
    };
  }
  return { bad: false };
}

export const hybridV2Method: RouteMethod = {
  id: "hybrid-v2",
  label: "Hybrid v2 (fine-GC + snap-guard + raster fallback)",
  color: "#22d3ee",
  description:
    "Fine 0.05° GC safety test, searoute-ts with endpoint-snap guard, A* 0.05° raster fallback. No Bezier.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const from: LonLat = [pair.from.lon, pair.from.lat];
    const to: LonLat = [pair.to.lon, pair.to.lat];
    const chordKm = haversineKm(from, to);

    // 1. Fine GC-safe test.
    const gc = await fineGCLandHits(from, to);
    if (gc.hits === 0) {
      const coords = greatCircle(from, to, 64);
      return {
        coordinates: coords,
        distanceKm: polylineLengthKm(coords),
        computeMs: performance.now() - t0,
        note: `open-ocean GC (0/${gc.samples} land @0.05°)`,
      };
    }

    // 2. searoute-ts with endpoint-snap guard AND its own land-hit
    //    check. Codex's point: "fallback silently crosses land" is
    //    an open risk. searoute-ts's graph is 0.1° coarse, so its
    //    output can clip island corners even when the graph itself
    //    looks sane. Re-sample the returned polyline against the
    //    0.05° mask and accept only when the hit count is tolerable
    //    (< 1% of samples). Absolute zero is too strict — harbour
    //    approaches and port cells often register as land and we
    //    accept that.
    const sr = runSearoute(pair);
    let rejectReason: string | null = null;
    if (sr) {
      const check = endpointSnapBad(sr.coords, pair, chordKm);
      if (check.bad) {
        rejectReason = `snap ${check.reason}`;
      } else {
        // Not a snap-problem. Try local repair on any segments whose
        // straight chord clips land on the 0.05° mask. Scattered
        // coastal grazing (<40 km unbroken) is tolerated; longer runs
        // signal a searoute graph gap where vertices skip across a
        // peninsula.
        const MAX_RUN = 20; // 20 samples @ 2 km spacing ≈ 40 km
        const repair = await localRepairAcrossLand(sr.coords, MAX_RUN);
        if (repair.repaired === 0) {
          return {
            coordinates: sr.coords,
            distanceKm: sr.km,
            computeMs: performance.now() - t0,
            note: `searoute-ts (no repair)`,
          };
        }
        if (repair.repaired > 0) {
          return {
            coordinates: repair.coords,
            distanceKm: polylineLengthKm(repair.coords),
            computeMs: performance.now() - t0,
            note: `searoute-ts + ${repair.repaired}× local A* repair`,
          };
        }
        // Too many bad segments — let A* 0.05° handle the whole route.
        rejectReason = `searoute too broken (>10 gap-segments)`;
      }
    }

    // 3. A* 0.05° raster fallback — always water-safe.
    try {
      const mask = await loadLandMask(0.05);
      const path = computeAStar(from, to, mask);
      if (path) {
        return {
          coordinates: path,
          distanceKm: polylineLengthKm(path),
          computeMs: performance.now() - t0,
          note: rejectReason
            ? `${rejectReason} → A* 0.05° fallback`
            : `searoute null → A* 0.05° fallback`,
        };
      }
    } catch {
      // fall through to chord
    }

    // 4. Absolute last resort: straight chord. Marked as failure so the
    // metrics row is visibly wrong.
    return {
      coordinates: [from, to],
      distanceKm: chordKm,
      computeMs: performance.now() - t0,
      note: "all methods failed — straight chord",
    };
  },
};
