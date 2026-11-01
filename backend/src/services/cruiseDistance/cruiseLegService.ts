/**
 * Persisted cruise-leg lifecycle.
 *
 * `recomputeLegsForCruise` rebuilds the `cruise_legs` rows for one
 * cruise from its current sorted port-call sequence. Idempotent —
 * deletes existing rows and re-inserts. Called when a cruise is
 * created, when stops change, or when the router/data version bumps.
 *
 * `getLegDistancesForCruise` returns just the distance numbers for
 * stats consumption.
 */

import type { Prisma } from "../../prisma";
import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import { buildEffectivePortSequence } from "../../shared/cruise/portSequence";
import { buildLegRouteOverrideMap, portLegRouteKey } from "../../shared/cruise/legRouteKey";
import { computeLegDistance } from "./index";
import { polylineDistanceKm } from "./polylineDistance";
import { CRUISE_TRACK_COVERAGE_SELECT, resolveRecordedLegs } from "./recordedLegs";
import type { ComputedLeg, PortPoint } from "./types";

/**
 * Bumps when the orchestrator's calculator chain or chaining logic changes.
 * Every row carries it as `routerVersion`, which is what the boot backfill
 * (`scripts/backfillCruiseLegs.ts`) compares: a bump recomputes every cruise.
 * 1.1.0 (2026-09-27): sea legs are measured along the drawn route.
 * 1.2.0 (2026-10-16): a river cruise's legs never go through the sea router,
 * and the river anchors ship in the image — Nile legs stored before it were
 * chords because `data/rivers` was missing there.
 */
export const ORCHESTRATOR_VERSION = "1.2.0";

/** `cruise_legs.method` of a leg measured along a recording (2.7). */
export const RECORDED_TRACK_METHOD = "recorded_track";

/**
 * Leg measurements computed BEFORE a transaction opens (forgejo#346).
 *
 * Sea routing (marnet A*, the fine mask, possibly the coarse A*) is slow and
 * ran once per leg, in sequence, inside the interactive transaction that
 * rewrites the cruise — a 12–15-port cruise with uncached pairs could outlast
 * the transaction timeout and fail the save with "Transaction already closed".
 * The writers now measure first, outside, and hand the result to
 * `recomputeLegsForCruise`, which then only reads, `deleteMany`s and
 * `createMany`s. The key is the full input of the measurement (both ports and
 * the cruise kind), so a stale or missing entry can only cost a recompute
 * inside the transaction — never a wrong number.
 */
export type LegDistanceCache = Map<string, ComputedLeg>;

const legCacheKey = (fromId: number, toId: number, kind: string | undefined) =>
  `${fromId}>${toId}|${kind ?? ""}`;

const toPortPoint = (p: {
  id: number;
  lat: number;
  lon: number;
  unlocode: string | null;
  region: string | null;
  name: string;
  city: string | null;
  country: string | null;
}): PortPoint => ({
  id: p.id,
  lat: p.lat,
  lon: p.lon,
  unlocode: p.unlocode,
  region: p.region,
  name: p.name,
  city: p.city,
  country: p.country,
});

/** Measure every consecutive pair of the itinerary the cruise is about to have. */
export async function precomputeLegDistances(input: {
  kind: string | undefined;
  departurePortId: number | null | undefined;
  arrivalPortId: number | null | undefined;
  /** Port calls in itinerary order; sea days and unresolved stops left out. */
  stopPortIds: number[];
  /** Which legs of the sequence a drawn line or a recording already decides. */
  coveredLegs?: (sequence: PortPoint[]) => boolean[];
}): Promise<LegDistanceCache> {
  const ids = [
    ...new Set(
      [input.departurePortId, input.arrivalPortId, ...input.stopPortIds].filter(
        (id): id is number => typeof id === "number"
      )
    ),
  ];
  const cache: LegDistanceCache = new Map();
  if (ids.length < 2) return cache;
  const ports = new Map(
    (await prisma.port.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p])
  );
  const point = (id: number | null | undefined) => {
    const port = id == null ? undefined : ports.get(id);
    return port ? toPortPoint(port) : null;
  };
  const sequence = buildEffectivePortSequence(
    point(input.departurePortId),
    input.stopPortIds.flatMap((id) => point(id) ?? []),
    point(input.arrivalPortId)
  );
  const covered = input.coveredLegs?.(sequence) ?? [];
  for (let i = 1; i < sequence.length; i++) {
    // A leg a recording or a manual line decides is never routed (see
    // `recomputeLegsForCruise`), so measuring it here would be wasted work.
    if (covered[i - 1]) continue;
    const key = legCacheKey(sequence[i - 1].id, sequence[i].id, input.kind);
    if (cache.has(key)) continue;
    cache.set(
      key,
      await computeLegDistance(sequence[i - 1], sequence[i], { cruiseKind: input.kind })
    );
  }
  return cache;
}

/** Same, for a cruise's itinerary as it is stored now (writes that leave stops alone). */
export async function precomputeLegDistancesForCruise(cruiseId: string): Promise<LegDistanceCache> {
  const [cruise, stops, overrides, tracks] = await Promise.all([
    prisma.cruise.findUnique({
      where: { id: cruiseId },
      select: { kind: true, departurePortId: true, arrivalPortId: true },
    }),
    prisma.cruiseStop.findMany({
      where: { cruiseId, isAtSea: false, portId: { not: null } },
      orderBy: { dayNumber: "asc" },
      select: { portId: true },
    }),
    prisma.cruiseLegRoute.findMany({
      where: { cruiseId },
      select: { fromKind: true, fromRef: true, toKind: true, toRef: true, waypoints: true },
    }),
    prisma.cruiseTrack.findMany({ where: { cruiseId }, select: CRUISE_TRACK_COVERAGE_SELECT }),
  ]);
  if (!cruise) return new Map();
  const overrideByLeg = buildLegRouteOverrideMap(overrides);
  return precomputeLegDistances({
    kind: cruise.kind,
    departurePortId: cruise.departurePortId,
    arrivalPortId: cruise.arrivalPortId,
    stopPortIds: stops.flatMap((s) => (s.portId === null ? [] : [s.portId])),
    coveredLegs: (sequence) => {
      const { recorded } = resolveRecordedLegs(sequence, tracks);
      return sequence.slice(1).map((to, i) => {
        const manual = overrideByLeg.get(portLegRouteKey(sequence[i].id, to.id));
        return recorded[i] !== null || (manual !== undefined && manual.length >= 2);
      });
    },
  });
}

export async function recomputeLegsForCruise(
  cruiseId: string,
  tx?: DbTransaction,
  precomputed?: LegDistanceCache
): Promise<number> {
  const client = tx ?? prisma;

  const [cruise, stops, overrides, tracks] = await Promise.all([
    client.cruise.findUnique({
      where: { id: cruiseId },
      include: { departurePort: true, arrivalPort: true },
    }),
    client.cruiseStop.findMany({
      where: { cruiseId, isAtSea: false, portId: { not: null } },
      orderBy: { dayNumber: "asc" },
      include: { port: true },
    }),
    client.cruiseLegRoute.findMany({
      where: { cruiseId },
      select: { fromKind: true, fromRef: true, toKind: true, toRef: true, waypoints: true },
    }),
    client.cruiseTrack.findMany({ where: { cruiseId }, select: CRUISE_TRACK_COVERAGE_SELECT }),
  ]);

  const portCallPorts = stops
    .filter((s): s is typeof s & { port: NonNullable<typeof s.port> } => s.port !== null)
    .map((s) => toPortPoint(s.port));

  // Legs cover the full route: departure port → port calls → arrival
  // port. Without this, a cruise whose itinerary lives only in
  // departurePort/arrivalPort produced zero legs — no distance stats
  // and no route on the map.
  const sequence = buildEffectivePortSequence(
    cruise?.departurePort ? toPortPoint(cruise.departurePort) : null,
    portCallPorts,
    cruise?.arrivalPort ? toPortPoint(cruise.arrivalPort) : null
  );

  // share-exempt: legs recomputed inside the cruise writes, which propagate after it
  await client.cruiseLeg.deleteMany({ where: { cruiseId } });

  if (sequence.length < 2) return 0;

  // A hand-corrected line wins over the router, and keeps winning: this lookup
  // is why a routerVersion bump cannot silently reset the user's kilometres
  // while the map still shows their line (spec §6, "The trap").
  const overrideByLeg = buildLegRouteOverrideMap(overrides);
  // A recording wins over both: it is what the ship actually sailed, where a
  // drawn line is the user's best guess and the router's is a model. Resolved
  // by the same function the map reads (`recordedLegs.ts`), so the kilometres
  // here are the kilometres of the line drawn there.
  const { recorded } = resolveRecordedLegs(sequence, tracks);

  const rows: Prisma.CruiseLegCreateManyInput[] = [];
  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1];
    const to = sequence[i];

    const measured = recorded[i - 1];
    if (measured !== null) {
      rows.push({
        cruiseId,
        ordinal: i - 1,
        fromPortId: from.id,
        toPortId: to.id,
        // Along the recording; a bridged hole counts as its chord.
        distanceKm: measured.slice.distanceKm,
        method: RECORDED_TRACK_METHOD,
        routerVersion: ORCHESTRATOR_VERSION,
        dataVersion: null,
        // Bridged holes are partly a chord, so not the full "high".
        confidence: measured.status === "covered" ? "high" : "medium",
        notes: null,
      });
      continue;
    }

    const manual = overrideByLeg.get(portLegRouteKey(from.id, to.id));
    if (manual && manual.length >= 2) {
      rows.push({
        cruiseId,
        ordinal: i - 1,
        fromPortId: from.id,
        toPortId: to.id,
        distanceKm: polylineDistanceKm(manual),
        // A first-class method, not a faked router result: anything reading
        // cruise_legs can tell a drawn line from a computed one.
        method: "manual_polyline",
        routerVersion: ORCHESTRATOR_VERSION,
        dataVersion: null,
        confidence: "high",
        notes: null,
      });
      continue;
    }

    const computed =
      precomputed?.get(legCacheKey(from.id, to.id, cruise?.kind)) ??
      (await computeLegDistance(from, to, { cruiseKind: cruise?.kind }));
    rows.push({
      cruiseId,
      ordinal: i - 1,
      fromPortId: from.id,
      toPortId: to.id,
      distanceKm: computed.distanceKm,
      method: computed.method,
      // The orchestrator's version, not the calculator's: it is what the
      // backfill compares, and the chain is what decides a leg's number.
      routerVersion: ORCHESTRATOR_VERSION,
      dataVersion: computed.dataVersion,
      confidence: computed.confidence,
      notes: computed.notes,
    });
  }

  if (rows.length > 0) {
    // share-exempt: legs recomputed inside the cruise writes, which propagate after it
    await client.cruiseLeg.createMany({ data: rows });
  }

  return rows.length;
}

export async function getLegDistancesForCruise(cruiseId: string): Promise<number[]> {
  const legs = await prisma.cruiseLeg.findMany({
    where: { cruiseId },
    orderBy: { ordinal: "asc" },
    select: { distanceKm: true },
  });
  return legs.map((l) => l.distanceKm);
}
