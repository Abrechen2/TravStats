import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import { derivedAround, type LegSpan } from "../legs/setMode";
import type { Stop } from "../legs/types";

/**
 * `PUT /travtrack/stops/dismissed` (travtrack-stop-dismiss-wait): mark a stop
 * as "only a wait" or take that back, and answer the recomputed stop. Like a
 * stop's accepted name it is bound to the span sent, not to a derived stop: it
 * applies to every stop it covers by more than half, so a late point does not
 * lose it. The day view still lists the stop, flagged `dismissed`, so the
 * owner can restore it; the points, legs and every figure are untouched.
 * Repeating the request changes nothing (one row per span). A span under no
 * stop is `TRAVTRACK_STOP_NOT_FOUND`; restoring drops the stored rows first
 * (the points may no longer make a stop) and then says so if none is there.
 */

const under = (stops: readonly Stop[], span: LegSpan) =>
  stops.filter((s) => overlapShare(s, span) > 0.5);

const notFound = () => new AppError("No stop under that span", 404, "TRAVTRACK_STOP_NOT_FOUND");

export async function setStopDismissed(
  userId: string,
  span: LegSpan,
  dismissed: boolean
): Promise<Stop> {
  if (dismissed) {
    if (under((await derivedAround(userId, span)).stops, span).length === 0) throw notFound();
    await prisma.travTrackStopDismissal.upsert({
      where: {
        userId_fromMs_untilMs: {
          userId,
          fromMs: BigInt(span.fromMs),
          untilMs: BigInt(span.untilMs),
        },
      },
      create: { userId, fromMs: BigInt(span.fromMs), untilMs: BigInt(span.untilMs) },
      update: {},
    });
  } else {
    const hit = under((await derivedAround(userId, span)).stops, span);
    const stored = await prisma.travTrackStopDismissal.findMany({
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
    await prisma.travTrackStopDismissal.deleteMany({ where: { userId, id: { in: drop } } });
  }
  const hit = under((await derivedAround(userId, span)).stops, span);
  if (hit.length === 0) throw notFound();
  return hit.reduce((best, s) => (overlapShare(s, span) > overlapShare(best, span) ? s : best));
}
