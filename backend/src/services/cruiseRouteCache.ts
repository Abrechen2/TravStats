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
import { computeSeaRoute } from './seaRouter';

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
 */
export const CACHE_VERSION = 3;

export interface RouteLineString {
  type: 'LineString';
  coordinates: [number, number][];
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

/**
 * Validate that a Prisma JSON value matches the LineString shape we
 * wrote. Defensive because Prisma's Json type is `unknown` at the type
 * level — a corrupted row must not crash the endpoint.
 */
function parseStoredGeometry(raw: Prisma.JsonValue): RouteLineString | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type !== 'LineString') return null;
  if (!Array.isArray(obj.coordinates)) return null;
  const coords = obj.coordinates;
  // Cheap shape-check: every element should be [lon, lat] number pairs.
  // Return null on any malformed entry so the caller treats the row as
  // a miss and recomputes.
  for (const pair of coords) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    if (typeof pair[0] !== 'number' || typeof pair[1] !== 'number') return null;
  }
  return { type: 'LineString', coordinates: coords as [number, number][] };
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
): Promise<RouteLineString | null> {
  const { dep, arr, reversed } = canonicalPair(aPortId, bPortId);

  const cached = await prisma.cruiseRouteCache.findUnique({
    where: { depPortId_arrPortId: { depPortId: dep, arrPortId: arr } },
  });

  if (cached !== null && cached.version === CACHE_VERSION) {
    const geometry = parseStoredGeometry(cached.geometry);
    if (geometry !== null) {
      logger.debug({
        operation: 'cruise_route_cache_hit',
        depPortId: dep,
        arrPortId: arr,
        coordinates: geometry.coordinates.length,
      });
      return reversed ? reverseLineString(geometry) : geometry;
    }
    // Fall through to recompute when parse fails — the row is corrupted.
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
  const route = await computeSeaRoute(
    aIsDep ? aCoords : bCoords,
    aIsDep ? bCoords : aCoords,
  );
  const durationMs = Date.now() - computeStart;

  if (route === null) {
    logger.warn({
      operation: 'cruise_route_cache_compute_null',
      depPortId: dep,
      arrPortId: arr,
      durationMs,
    });
    return null;
  }

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
    coordinates: route.coordinates.length,
    durationMs,
  });

  return reversed ? reverseLineString(route) : route;
}
