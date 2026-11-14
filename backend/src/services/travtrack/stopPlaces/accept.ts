import { prisma } from "../../../db";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import type { LegSpan } from "../legs/setMode";
import type { Stop } from "../legs/types";
import { resolveStays, stopNotFound } from "./resolve";

/**
 * `PUT /travtrack/stops/place` (spec "As built — stop places"): store the name
 * the owner accepted for a stop, or remove it with `null`, and answer the
 * recomputed stop. Bound to the span sent, not to a point or a derived stop,
 * so it survives a late point; a span under no stop is
 * `TRAVTRACK_STOP_NOT_FOUND` and stores nothing. The span sent is a part of a stay
 * as the day view shows it; the name is stored on the WHOLE stay (`resolve.ts`), so
 * both days of a night show it, and it is read against the unclipped stay. Removing first drops every
 * stored name that covers a stop under the span, then says so if no stop is
 * there (the points may no longer make one).
 */

export type AcceptedPlace = { name: string; lat?: number | null; lon?: number | null };

export async function setStopPlace(
  userId: string,
  span: LegSpan,
  place: AcceptedPlace | null
): Promise<Stop> {
  const { stay } = await resolveStays(userId, span);
  if (place === null) {
    const stored = await prisma.travTrackStopPlace.findMany({
      where: {
        userId,
        fromMs: { lt: BigInt(Math.max(span.untilMs, stay?.untilMs ?? 0)) },
        untilMs: { gt: BigInt(Math.min(span.fromMs, stay?.fromMs ?? span.fromMs)) },
      },
      select: { id: true, fromMs: true, untilMs: true },
    });
    const drop = stored
      .filter(
        (r) =>
          (Number(r.fromMs) === span.fromMs && Number(r.untilMs) === span.untilMs) ||
          (stay !== null &&
            overlapShare(stay, { fromMs: Number(r.fromMs), untilMs: Number(r.untilMs) }) > 0.5)
      )
      .map((r) => r.id);
    await prisma.travTrackStopPlace.deleteMany({ where: { userId, id: { in: drop } } });
  } else {
    if (stay === null) throw stopNotFound();
    const data = { name: place.name, lat: place.lat ?? null, lon: place.lon ?? null };
    const [fromMs, untilMs] = [BigInt(stay.fromMs), BigInt(stay.untilMs)];
    await prisma.travTrackStopPlace.upsert({
      where: { userId_fromMs_untilMs: { userId, fromMs, untilMs } },
      create: { userId, fromMs, untilMs, ...data },
      update: data,
    });
  }
  const { part } = await resolveStays(userId, span);
  if (part === null) throw stopNotFound();
  return part;
}
