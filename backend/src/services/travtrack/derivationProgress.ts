import { prisma } from "../../db";
import { COUNTRY_DAYS_BIT, EXPLORED_BIT, MONTHS_BIT } from "./dirtyDays";
import { PROJECTION_DAYS_PER_RUN } from "./countryProjection";

/** The schedule's tick (`travTrackProjectionScheduler`: every 15 minutes). */
const TICK_MINUTES = 15;
const DERIVED_BITS = COUNTRY_DAYS_BIT | EXPLORED_BIT | MONTHS_BIT;

export type DerivationProgress = {
  pendingDays: number;
  totalDays: number;
  estimateMinutes: number;
};

/**
 * How far the day-by-day derivation has come (country days, explored cells, month
 * figures; the visit suggestions look at the last 30 days only and are not counted).
 * A 13-year import queues thousands of days that the schedule works off 62 a tick, so
 * the owner would otherwise watch an empty calendar fill for a day without a word.
 */
export async function derivationProgress(userId: string): Promise<DerivationProgress> {
  const [row] = await prisma.$queryRaw<{ total: bigint; pending: bigint }[]>`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE (done & ${DERIVED_BITS}) <> ${DERIVED_BITS}) AS pending
      FROM travtrack_dirty_days WHERE user_id = ${userId}`;
  const pendingDays = Number(row?.pending ?? 0);
  return {
    pendingDays,
    totalDays: Number(row?.total ?? 0),
    estimateMinutes: Math.ceil(pendingDays / PROJECTION_DAYS_PER_RUN) * TICK_MINUTES,
  };
}
