/**
 * cruiseRouteCache.ts — Persistent cache in front of the A* sea-router.
 *
 * Phase 3 of the cruise-map-V2 plan. The geometry endpoint used to call
 * `computeSeaRoute` on every request (~1 s for a transatlantic cruise,
 * 400+ ms for a Mediterranean one); now a DB lookup pre-empts the
 * compute on repeat queries so warm requests land in single-digit ms.
 *
 * Cache strategy:
 *   - Primary key is the unordered port-pair. We always store rows with
 *     `depPortId <= arrPortId` so queries in either direction hit the
 *     same row. The returned geometry is reversed when the caller asked
 *     for the opposite direction.
 *   - `version` is bumped whenever the raster or canal overrides
 *     change. Old rows stay on disk but are ignored on read (lazy
 *     invalidation — next compute overwrites them). No stampede worry
 *     because cruise-route demand is bounded per user.
 *   - Negative results (A* returned null — landlocked port) are NOT
 *     cached. The Bezier fallback is cheap on the frontend and we
 *     want a second attempt if the port coordinates were edited.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import logger from '../utils/logger';
import {
  classifyRouteQuality,
  computeSeaRoute,
  type RouteQuality,
} from './seaRouter';

/**
 * Bump whenever the behaviour of `computeSeaRoute` changes materially
 * (new raster resolution, new canal overrides, new A* heuristics).
 * Rows with a lower version are ignored on read and overwritten on the
 * next compute, so a bump is a pure roll-forward — no DB wipe needed.
 *
 *   1 = Phase-1 walking skeleton
 *   2 = Phase-2 canal overrides wired in
 *   3 = Kiel Canal dropped (cruise ships don't fit); findNearestWater
 *       default bumped 50 → 5000 so Hamburg-class inland ports snap
 *       to the open sea instead of falling back to Bezier
 *   4 = computeSeaRoute no longer prepends/appends the raw port coord
 *       for inland ports — the straight segment from a river port like
 *       Hamburg to the snapped-water cell drew a cyan line across
 *       Schleswig-Holstein, which users reported as "the route goes
 *       through land"
 *   5 = Brief dilation experiment — DO NOT use, rows are broken.
 *   6 = Dilation reverted (0.1° raster too coarse — dilating land by
 *       1 cell closed Øresund / Danish Straits and killed every
 *       Baltic leg). Behaves like v4. Version bumped so v5 rows
 *       written during the experiment get discarded and recomputed.
 *   7 = Hybrid v2 pipeline (sea-route lab winner): fine 0.05° GC
 *       safety check → searoute-ts (Eurostat marnet) + endpoint-snap
 *       guard + local 0.05° A* repair → whole-route 0.1° A* as last
 *       resort. Replaces the pure 0.1° A*-only approach of v6.
 *   8 = Local repair now distinguishes resolved vs. unresolved
 *       bad segments. Any unresolved segment forces a fall-through to
 *       the whole-route A* fallback, preventing land-crossings from
 *       slipping through (Aegean / Dardanelles / Bosporus cases where
 *       fine-A* hits its budget on narrow straits).
 *   9 = Cached rows now include a `quality` classification ("good" |
 *       "schematic") and `landRatio` alongside the LineString, so the
 *       frontend can render bad routes as dashed chords instead of
 *       lying zig-zag polylines over Bavaria. Old v8 rows have no
 *       quality and are recomputed on demand.
 *  10 = Pipeline hardening: searoute+repair branch now gates on the
 *       final quality (≥ 25 % interior-land vertices → fall through to
 *       whole-route A*) instead of returning whatever the repair
 *       produced. Legs with accumulated short land-crossings
 *       (Bremerhaven → Hamburg, Hamburg → Bergen, Rotterdam
 *       → Bremerhaven, …) now route via the coarse A* and are
 *       good-quality.
 *  11 = Last-resort 0.05° whole-route A* added to the pipeline. Narrow
 *       passages the 0.1° mask closes entirely (Øresund, Alaska
 *       Inside Passage, Sognefjord mouth) now resolve on the fine
 *       mask — Oslo → Copenhagen, Skagway → Ketchikan, Bergen → Flåm
 *       stop returning null.
 */
export const CACHE_VERSION = 11;

export interface RouteLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface CachedRoute {
  line: RouteLineString;
  quality: RouteQuality;
  landRatio: number;
}

/**
 * Canonical key order: smaller port id first. Callers pass their real
 * leg direction and we flip on the way out if the stored row uses the
 * opposite orientation.
 */
function canonicalPair(a: number, b: number): { dep: number; arr: number; reversed: boolean } {
  if (a <= b) return { dep: a, arr: b, reversed: false };
  return { dep: b, arr: a, reversed: true };
}

function reverseLineString(line: RouteLineString): RouteLineString {
  return { type: 'LineString', coordinates: [...line.coordinates].reverse() };
}

function reverseCached(route: CachedRoute): CachedRoute {
  return { ...route, line: reverseLineString(route.line) };
}

/**
 * Validate that a Prisma JSON value matches the `CachedRoute` shape we
 * wrote. Defensive because Prisma's Json type is `unknown` at the type
 * level — a corrupted row must not crash the endpoint.
 *
 * Accepts the v9 wrapper `{ line: {type, coordinates}, quality,
 * landRatio }`. Bare LineStrings (v8 leftovers that somehow survived
 * the version check) are rejected so we recompute with a classification.
 */
function parseStoredGeometry(raw: Prisma.JsonValue): CachedRoute | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const line = obj.line;
  if (!line || typeof line !== 'object' || Array.isArray(line)) return null;
  const lineObj = line as Record<string, unknown>;
  if (lineObj.type !== 'LineString') return null;
  if (!Array.isArray(lineObj.coordinates)) return null;
  for (const pair of lineObj.coordinates) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    if (typeof pair[0] !== 'number' || typeof pair[1] !== 'number') return null;
  }
  const quality = obj.quality === 'good' || obj.quality === 'schematic' ? obj.quality : null;
  if (quality === null) return null;
  const landRatio = typeof obj.landRatio === 'number' ? obj.landRatio : null;
  if (landRatio === null) return null;
  return {
    line: {
      type: 'LineString',
      coordinates: lineObj.coordinates as [number, number][],
    },
    quality,
    landRatio,
  };
}

/**
 * Return a sea-route for the leg (a) → (b), serving it from the cache
 * when possible and falling back to A* on miss or version mismatch.
 * `null` means the A* run itself failed (port snapped inland, etc.);
 * misses are not persisted.
 */
export async function getOrComputeSeaRoute(
  aPortId: number,
  bPortId: number,
  aCoords: { lat: number; lon: number },
  bCoords: { lat: number; lon: number },
): Promise<CachedRoute | null> {
  const { dep, arr, reversed } = canonicalPair(aPortId, bPortId);

  const cached = await prisma.cruiseRouteCache.findUnique({
    where: { depPortId_arrPortId: { depPortId: dep, arrPortId: arr } },
  });

  if (cached !== null && cached.version === CACHE_VERSION) {
    const parsed = parseStoredGeometry(cached.geometry);
    if (parsed !== null) {
      logger.debug({
        operation: 'cruise_route_cache_hit',
        depPortId: dep,
        arrPortId: arr,
        coordinates: parsed.line.coordinates.length,
        quality: parsed.quality,
      });
      return reversed ? reverseCached(parsed) : parsed;
    }
    logger.warn({
      operation: 'cruise_route_cache_parse_failed',
      depPortId: dep,
      arrPortId: arr,
    });
  }

  // Miss / stale / corrupted → compute. Always run A* in the canonical
  // direction so we store one orientation per port pair.
  const aIsDep = !reversed;
  const computeStart = Date.now();
  const line = await computeSeaRoute(
    aIsDep ? aCoords : bCoords,
    aIsDep ? bCoords : aCoords,
  );
  const durationMs = Date.now() - computeStart;

  if (line === null) {
    logger.warn({
      operation: 'cruise_route_cache_compute_null',
      depPortId: dep,
      arrPortId: arr,
      durationMs,
    });
    return null;
  }

  const { quality, landRatio } = classifyRouteQuality(line.coordinates);
  const route: CachedRoute = { line, quality, landRatio };

  await prisma.cruiseRouteCache.upsert({
    where: { depPortId_arrPortId: { depPortId: dep, arrPortId: arr } },
    create: {
      depPortId: dep,
      arrPortId: arr,
      geometry: route as unknown as Prisma.InputJsonValue,
      version: CACHE_VERSION,
    },
    update: {
      geometry: route as unknown as Prisma.InputJsonValue,
      version: CACHE_VERSION,
      computedAt: new Date(),
    },
  });

  logger.info({
    operation: 'cruise_route_cache_miss',
    depPortId: dep,
    arrPortId: arr,
    coordinates: line.coordinates.length,
    quality,
    landRatio: Math.round(landRatio * 100) / 100,
    durationMs,
  });

  return reversed ? reverseCached(route) : route;
}
