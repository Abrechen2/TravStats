import { prisma } from "../db";
import { calculateNextApiCheckAt } from "../utils/smartCheckSchedule";

export type ApiCheckBackfillResult = {
  candidates: number;
  filled: number;
  pulledEarlier: number;
  skipped: number;
};

const DEFAULT_BATCH_SIZE = 500;

/**
 * Start-up pass over scheduled flights (runs on every start, idempotent).
 *
 * 1. A flight with no `nextApiCheckAt` gets one (as it always did).
 * 2. A flight that has not departed yet gets the earlier of its stored check
 *    and the one the current schedule computes. Flights stored before the
 *    push checkpoints (D-24h, D-3h, every 15 min; TravStats#156) still carry
 *    their old D-30min check, and the status job would otherwise only see
 *    them half an hour before departure. Only ever earlier, never later: a
 *    stored check that is already sooner (a follow-up the job set) stays.
 *
 * Read in id-ordered pages and written per page in one transaction, so a
 * large instance neither loads every flight at once nor issues one
 * round-trip per row outside a transaction.
 */
export async function backfillNextApiCheckAt(
  now: Date = new Date(),
  opts: { batchSize?: number } = {}
): Promise<ApiCheckBackfillResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const result: ApiCheckBackfillResult = { candidates: 0, filled: 0, pulledEarlier: 0, skipped: 0 };
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.flight.findMany({
      where: {
        status: "scheduled",
        flightNumber: { not: null },
        departureTime: { not: null },
        OR: [{ nextApiCheckAt: null }, { departureTime: { gt: now } }],
      },
      select: {
        id: true,
        departureTime: true,
        arrivalTime: true,
        status: true,
        flightNumber: true,
        nextApiCheckAt: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    result.candidates += page.length;

    const updates: Array<{ id: string; nextApiCheckAt: Date }> = [];
    for (const f of page) {
      const checkAt = calculateNextApiCheckAt(
        f.departureTime,
        f.arrivalTime,
        f.status,
        f.flightNumber,
        now
      );
      if (!checkAt) {
        if (!f.nextApiCheckAt) result.skipped++;
        continue;
      }
      if (!f.nextApiCheckAt) {
        updates.push({ id: f.id, nextApiCheckAt: checkAt });
        result.filled++;
      } else if (checkAt < f.nextApiCheckAt) {
        updates.push({ id: f.id, nextApiCheckAt: checkAt });
        result.pulledEarlier++;
      }
    }
    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.flight.update({ where: { id: u.id }, data: { nextApiCheckAt: u.nextApiCheckAt } })
        )
      );
    }
    if (page.length < batchSize) break;
  }
  return result;
}
