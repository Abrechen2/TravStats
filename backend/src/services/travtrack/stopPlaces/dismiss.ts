import { prisma } from "../../../db";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import type { LegSpan } from "../legs/setMode";
import type { Stop } from "../legs/types";
import { resolveStays, stopNotFound } from "./resolve";

/**
 * `PUT /travtrack/stops/dismissed` (travtrack-stop-dismiss-wait): mark a stop
 * as "only a wait" or take that back, and answer the recomputed stop. Like a
 * stop's accepted name it is bound to a span, not to a derived stop, so a late
 * point does not lose it: the span stored is the WHOLE stay's (the span sent is
 * a part of it as the day view clips it), and it covers every stop it holds by
 * more than half. The day view still lists the stop, flagged `dismissed`, so the
 * owner can restore it; the points, legs and every figure are untouched.
 * Repeating the request changes nothing (one row per span). A span under no
 * stop is `TRAVTRACK_STOP_NOT_FOUND`; restoring drops the stored rows first
 * (the points may no longer make a stop) and then says so if none is there.
 */

export async function setStopDismissed(
  userId: string,
  span: LegSpan,
  dismissed: boolean
): Promise<Stop> {
  // The span is a part of a stay as the day view shows it; the dismissal belongs to the WHOLE
  // stay (`resolve.ts`), so both days of a night show it and either part can restore it.
  const { stay, all } = await resolveStays(userId, span);
  if (dismissed) {
    if (stay === null) throw stopNotFound();
    const [fromMs, untilMs] = [BigInt(stay.fromMs), BigInt(stay.untilMs)];
    await prisma.travTrackStopDismissal.upsert({
      where: { userId_fromMs_untilMs: { userId, fromMs, untilMs } },
      create: { userId, fromMs, untilMs },
      update: {},
    });
  } else {
    const stored = await prisma.travTrackStopDismissal.findMany({
      where: {
        userId,
        fromMs: { lt: BigInt(Math.max(span.untilMs, stay?.untilMs ?? 0)) },
        untilMs: { gt: BigInt(Math.min(span.fromMs, stay?.fromMs ?? span.fromMs)) },
      },
      select: { id: true, fromMs: true, untilMs: true },
    });
    const rowSpan = (r: { fromMs: bigint; untilMs: bigint }) => ({
      fromMs: Number(r.fromMs),
      untilMs: Number(r.untilMs),
    });
    const drop = stored.filter(
      (r) =>
        (Number(r.fromMs) === span.fromMs && Number(r.untilMs) === span.untilMs) ||
        (stay !== null && overlapShare(stay, rowSpan(r)) > 0.5)
    );
    // Late points may have split one dismissed stop into two: the row that held both must
    // keep holding the one that is not being restored.
    const keep = all.filter(
      (s) =>
        !(s.fromMs === stay?.fromMs && s.untilMs === stay?.untilMs) &&
        s.dismissed === true &&
        drop.some((r) => overlapShare(s, rowSpan(r)) > 0.5)
    );
    await prisma.$transaction([
      prisma.travTrackStopDismissal.deleteMany({
        where: { userId, id: { in: drop.map((r) => r.id) } },
      }),
      ...keep.map((s) =>
        prisma.travTrackStopDismissal.upsert({
          where: {
            userId_fromMs_untilMs: {
              userId,
              fromMs: BigInt(s.fromMs),
              untilMs: BigInt(s.untilMs),
            },
          },
          create: { userId, fromMs: BigInt(s.fromMs), untilMs: BigInt(s.untilMs) },
          update: {},
        })
      ),
    ]);
  }
  const { part } = await resolveStays(userId, span);
  if (part === null) throw stopNotFound();
  return part;
}
