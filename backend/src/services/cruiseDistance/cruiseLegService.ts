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

import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { buildEffectivePortSequence } from "../../shared/cruise/portSequence";
import { computeLegDistance } from "./index";
import { polylineDistanceKm } from "./polylineDistance";
import type { PortPoint } from "./types";

/** Bumps when the orchestrator's calculator chain or chaining logic changes. */
export const ORCHESTRATOR_VERSION = "1.0.0";

export async function recomputeLegsForCruise(
  cruiseId: string,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const client = tx ?? prisma;

  const [cruise, stops, overrides] = await Promise.all([
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
    cruise?.arrivalPort ? toPortPoint(cruise.arrivalPort) : null,
  );

  await client.cruiseLeg.deleteMany({ where: { cruiseId } });

  if (sequence.length < 2) return 0;

  // A hand-corrected line wins over the router, and keeps winning: this lookup
  // is why a routerVersion bump cannot silently reset the user's kilometres
  // while the map still shows their line (spec §6, "The trap").
  const overrideByLeg = new Map<string, Array<[number, number]>>();
  for (const o of overrides) {
    if (!Array.isArray(o.waypoints)) continue;
    overrideByLeg.set(`${o.fromKind}:${o.fromRef}:${o.toKind}:${o.toRef}`, o.waypoints as Array<[number, number]>);
  }

  const rows: Prisma.CruiseLegCreateManyInput[] = [];
  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1];
    const to = sequence[i];

    const manual = overrideByLeg.get(`port:${from.id}:port:${to.id}`);
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
