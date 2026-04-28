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
import { computeLegDistance } from "./index";
import type { PortPoint } from "./types";

/** Bumps when the orchestrator's calculator chain or chaining logic changes. */
export const ORCHESTRATOR_VERSION = "1.0.0";

interface PortCallStop {
  portId: number;
  dayNumber: number;
  port: PortPoint | null;
}

export async function recomputeLegsForCruise(
  cruiseId: string,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const client = tx ?? prisma;

  const stops = await client.cruiseStop.findMany({
    where: { cruiseId, isAtSea: false, portId: { not: null } },
    orderBy: { dayNumber: "asc" },
    include: { port: true },
  });

  const portCalls: PortCallStop[] = stops
    .filter((s): s is typeof s & { portId: number; port: NonNullable<typeof s.port> } =>
      s.portId !== null && s.port !== null,
    )
    .map((s) => ({
      portId: s.portId,
      dayNumber: s.dayNumber,
      port: {
        id: s.port.id,
        lat: s.port.lat,
        lon: s.port.lon,
        unlocode: s.port.unlocode,
        region: s.port.region,
      },
    }));

  await client.cruiseLeg.deleteMany({ where: { cruiseId } });

  if (portCalls.length < 2) return 0;

  const rows: Prisma.CruiseLegCreateManyInput[] = [];
  for (let i = 1; i < portCalls.length; i++) {
    const from = portCalls[i - 1].port;
    const to = portCalls[i].port;
    if (!from || !to) continue;

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
