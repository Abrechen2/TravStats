import { Prisma } from "@prisma/client";

import { AppError } from "../../middleware/errorHandler";
import { planLegs } from "../../shared/tour/legPlan";
import { legDistanceKm, type LegSource } from "./tourDistance";

/**
 * Bring a section's legs in line with its stop order. Extracted out of
 * `routes/trips/tourRoutes.ts` because a second writer — the stop DELETE
 * handler in `routes/trips.ts` — needs the exact same recompute, and a
 * router is the wrong home for logic two routers depend on.
 */

export type Tx = Prisma.TransactionClient;

export interface StopCoords {
  id: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Legs whose endpoint pair survives keep their row — geometry, source and
 * manual costs included. Pairs that vanished are deleted; new pairs start
 * as `straight`. Nothing here consults the previous ORDER, only the pairs,
 * which is what makes an insertion (or a deletion) cheap.
 */
export async function recomputeLegs(
  tx: Tx,
  routeId: string,
  defaultMode: string,
  orderedStops: readonly StopCoords[],
): Promise<void> {
  const existing = await tx.tripRouteLeg.findMany({
    where: { routeId },
    select: { id: true, fromStopId: true, toStopId: true },
  });

  const plan = planLegs(
    orderedStops.map((s) => s.id),
    existing,
  );

  if (plan.deleteIds.length > 0) {
    await tx.tripRouteLeg.deleteMany({ where: { id: { in: plan.deleteIds } } });
  }

  // Built as a plain array and written with ONE createMany, not one create
  // per pair: at the 512-stop cap this is up to 511 rows, and awaiting them
  // one at a time inside an interactive transaction risks the 5s Prisma
  // default (raised by the caller, but there is no reason to spend the
  // budget on round-trips the distances don't need — they're already
  // computed in JS).
  const byId = new Map(orderedStops.map((s) => [s.id, s]));
  const rows: Prisma.TripRouteLegCreateManyInput[] = plan.create.map((pair) => {
    const from = byId.get(pair.fromStopId);
    const to = byId.get(pair.toStopId);
    // Guarded by the caller, which rejects coordinate-less stops before
    // reaching here; the check keeps the invariant local and typed.
    if (!from || !to || from.lat === null || from.lon === null || to.lat === null || to.lon === null) {
      throw new AppError("Every route stop needs a coordinate", 400);
    }
    return {
      routeId,
      fromStopId: pair.fromStopId,
      toStopId: pair.toStopId,
      source: "straight" satisfies LegSource,
      mode: defaultMode,
      confidence: "low",
      distanceKm: legDistanceKm({
        source: "straight",
        from: { lat: from.lat, lon: from.lon },
        to: { lat: to.lat, lon: to.lon },
      }),
    };
  });
  if (rows.length > 0) {
    await tx.tripRouteLeg.createMany({ data: rows });
  }
}
