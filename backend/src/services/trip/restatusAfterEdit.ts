import { prisma } from "../../db";
import { recomputeTripStatus } from "../tripStatusService";

/**
 * A trip whose own dates just moved needs its status re-derived.
 *
 * The PATCH handler never recomputed anything: a trip with no flight and no
 * cruise was created as `completed` from a 2020 date, edited to 2030, answered
 * 200 — and stayed `completed`, through the edit, an explicit recompute and the
 * nightly sweep alike (audit finding AUD-024). The other two now share one
 * bounds rule (`tripStatusBounds`); this is the third caller.
 *
 * Lives here because `routes/trips.ts` is over the 800-line limit and frozen at
 * its size.
 */
export async function restatusIfDatesMoved<T extends { id: string }>(
  trip: T,
  body: { startDate?: unknown; endDate?: unknown },
): Promise<T> {
  if (body.startDate === undefined && body.endDate === undefined) return trip;

  await recomputeTripStatus(trip.id);
  // Re-read so the response carries the status the caller will see on reload,
  // rather than the one the update returned a moment before it changed.
  const refreshed = await prisma.trip.findUnique({ where: { id: trip.id } });
  return (refreshed as T | null) ?? trip;
}
