import { Prisma } from "@prisma/client";

import { AppError } from "../../middleware/errorHandler";
import { planLegs } from "../../shared/tour/legPlan";
import { legDistanceKm, type LegSource } from "./tourDistance";

/** Just enough of the client to open a transaction — keeps this testable. */
type PrismaLike = { $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> };

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

/**
 * A stop moved. Bring the legs that end at it back into agreement.
 *
 * `recomputeLegs` above answers "which PAIRS exist" and deliberately keeps a
 * pair it already has — that is what makes inserting or deleting a stop cheap.
 * It therefore never noticed a stop whose coordinates changed underneath it: two
 * stops at (0,0) and (1,0) make a 111 km leg, and moving the second to (10,0)
 * left the stored 111 km and the old line in place, so the map and the recorded
 * kilometres disagreed with the stop the user had just dragged (audit finding
 * AUD-027). Sending the same order again did not heal it either, for the same
 * reason.
 *
 * The two sources are treated differently on purpose:
 *
 * - `straight` is derived from the endpoints and nothing else, so it is simply
 *   recomputed.
 * - `drawn` is a line a person drew. It is NOT deleted and NOT replaced by a
 *   straight chord — that would throw away work without asking. Its confidence
 *   drops to `low`, which is the signal the UI already understands, and the
 *   geometry stays for the user to re-anchor.
 */
export async function refreshLegsForMovedStop(
  tx: Tx,
  stopId: string,
): Promise<void> {
  const legs = await tx.tripRouteLeg.findMany({
    where: { OR: [{ fromStopId: stopId }, { toStopId: stopId }] },
    select: { id: true, source: true, fromStopId: true, toStopId: true },
  });
  if (legs.length === 0) return;

  const stopIds = [...new Set(legs.flatMap((l) => [l.fromStopId, l.toStopId]))];
  const stops = await tx.tripStop.findMany({
    where: { id: { in: stopIds } },
    select: { id: true, lat: true, lon: true },
  });
  const byId = new Map(stops.map((s) => [s.id, s]));

  for (const leg of legs) {
    if (leg.source !== "straight") {
      // Drawn by hand: keep it, but stop calling it trustworthy.
      await tx.tripRouteLeg.update({
        where: { id: leg.id },
        data: { confidence: "low" },
      });
      continue;
    }

    const from = byId.get(leg.fromStopId);
    const to = byId.get(leg.toStopId);
    if (
      !from || !to ||
      from.lat === null || from.lon === null ||
      to.lat === null || to.lon === null
    ) {
      // The PATCH route refuses to clear a route member's coordinates, so this
      // is unreachable through the API; skipping beats writing a wrong number.
      continue;
    }

    await tx.tripRouteLeg.update({
      where: { id: leg.id },
      data: {
        distanceKm: legDistanceKm({
          source: "straight",
          from: { lat: from.lat, lon: from.lon },
          to: { lat: to.lat, lon: to.lon },
        }),
        computedAt: new Date(),
      },
    });
  }
}

/** The fields `PATCH /trips/:id/stops/:stopId` may write. */
export interface StopPatch {
  title?: string;
  domain?: string | null;
  sourceId?: string | null;
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  lat?: number | null;
  lon?: number | null;
  notes?: string | null;
  orderIdx?: number;
}

/**
 * Update a stop and, when it actually moved, the legs that end at it.
 *
 * One transaction on purpose: a section must never be observable with a stop in
 * one place and its legs measuring another (audit finding AUD-027). Lives here
 * rather than in the route because `routes/trips.ts` is over the 800-line limit
 * and frozen at its size.
 *
 * "Moved" is compared against the stored value, not merely "a coordinate was
 * sent" — re-saving a form without touching the map must not knock a drawn
 * line's confidence down.
 */
export async function updateStopAndLegs(
  prismaClient: PrismaLike,
  stopId: string,
  body: StopPatch,
  existing: { routeId: string | null; lat: number | null; lon: number | null },
) {
  const moved =
    existing.routeId !== null &&
    ((body.lat !== undefined && body.lat !== existing.lat) ||
      (body.lon !== undefined && body.lon !== existing.lon));

  return prismaClient.$transaction(async (tx: Tx) => {
    const updated = await tx.tripStop.update({
      where: { id: stopId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.domain !== undefined && { domain: body.domain }),
        ...(body.sourceId !== undefined && { sourceId: body.sourceId }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.startDate !== undefined && { startDate: body.startDate }),
        ...(body.endDate !== undefined && { endDate: body.endDate }),
        ...(body.lat !== undefined && { lat: body.lat }),
        ...(body.lon !== undefined && { lon: body.lon }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.orderIdx !== undefined && { orderIdx: body.orderIdx }),
      },
    });

    if (moved) await refreshLegsForMovedStop(tx, stopId);

    return updated;
  });
}
