import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import { derivedAround, type LegSpan } from "../legs/setMode";
import type { Stop } from "../legs/types";

/**
 * `PUT /travtrack/stops/place` (spec "As built — stop places"): store the name
 * the owner accepted for a stop, or remove it with `null`, and answer the
 * recomputed stop. Bound to the span sent, not to a point or a derived stop,
 * so it survives a late point; a span under no stop is
 * `TRAVTRACK_STOP_NOT_FOUND` and stores nothing. Removing first drops every
 * stored name that covers a stop under the span, then says so if no stop is
 * there (the points may no longer make one).
 */

export type AcceptedPlace = { name: string; lat?: number | null; lon?: number | null };

const under = (stops: readonly Stop[], span: LegSpan) =>
  stops.filter((s) => overlapShare(s, span) > 0.5);

const notFound = () => new AppError("No stop under that span", 404, "TRAVTRACK_STOP_NOT_FOUND");

export async function setStopPlace(
  userId: string,
  span: LegSpan,
  place: AcceptedPlace | null
): Promise<Stop> {
  if (place === null) {
    const hit = under((await derivedAround(userId, span)).stops, span);
    const stored = await prisma.travTrackStopPlace.findMany({
      where: {
        userId,
        fromMs: { lt: BigInt(span.untilMs) },
        untilMs: { gt: BigInt(span.fromMs) },
      },
      select: { id: true, fromMs: true, untilMs: true },
    });
    const drop = stored
      .filter(
        (r) =>
          (Number(r.fromMs) === span.fromMs && Number(r.untilMs) === span.untilMs) ||
          hit.some(
            (s) => overlapShare(s, { fromMs: Number(r.fromMs), untilMs: Number(r.untilMs) }) > 0.5
          )
      )
      .map((r) => r.id);
    await prisma.travTrackStopPlace.deleteMany({ where: { userId, id: { in: drop } } });
  } else {
    if (under((await derivedAround(userId, span)).stops, span).length === 0) throw notFound();
    const data = { name: place.name, lat: place.lat ?? null, lon: place.lon ?? null };
    await prisma.travTrackStopPlace.upsert({
      where: {
        userId_fromMs_untilMs: {
          userId,
          fromMs: BigInt(span.fromMs),
          untilMs: BigInt(span.untilMs),
        },
      },
      create: { userId, fromMs: BigInt(span.fromMs), untilMs: BigInt(span.untilMs), ...data },
      update: data,
    });
  }
  const hit = under((await derivedAround(userId, span)).stops, span);
  if (hit.length === 0) throw notFound();
  return hit.reduce((best, s) => (overlapShare(s, span) > overlapShare(best, span) ? s : best));
}
