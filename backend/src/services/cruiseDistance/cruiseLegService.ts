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
import type { PortPoint } from "./types";

/** Bumps when the orchestrator's calculator chain or chaining logic changes. */
export const ORCHESTRATOR_VERSION = "1.0.0";

/** `cruise_legs.method` of a leg measured along a recording (2.7). */
export const RECORDED_TRACK_METHOD = "recorded_track";

export async function recomputeLegsForCruise(
  cruiseId: string,
  tx?: DbTransaction
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

  const toPortPoint = (p: {
    id: number;
    lat: number;
    lon: number;
    unlocode: string | null;
    region: string | null;
  }): PortPoint => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    unlocode: p.unlocode,
    region: p.region,
  });

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

    const computed = await computeLegDistance(from, to);
    rows.push({
      cruiseId,
      ordinal: i - 1,
      fromPortId: from.id,
      toPortId: to.id,
      distanceKm: computed.distanceKm,
      method: computed.method,
      routerVersion: computed.routerVersion,
      dataVersion: computed.dataVersion,
      confidence: computed.confidence,
      notes: computed.notes,
    });
  }

  if (rows.length > 0) {
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
