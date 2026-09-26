import { prisma } from "../../db";
import logger from "../../utils/logger";
import { applyFxSnapshot } from "../fx/stayFx";
import { getBaseCurrency } from "../fx/snapshot";

/**
 * Takes the FX snapshot a priced, dated, foreign-currency stay never got.
 *
 * A stay's snapshot is taken when it is written. When the rate lookup fails at
 * that moment — the ECB unreachable from a homelab, a provider outage — the
 * stay is stored without one (`applyFxSnapshot` never fails a write), and
 * nothing ever asked again: the card said "kein Kurs — not in totals" for as
 * long as nobody happened to re-save the stay, although a rate for its day
 * existed all along (browser acceptance 2026-09-26: saving once turned the
 * same USD stay into an ECB conversion).
 *
 * The pass only FILLS: a stay that has a snapshot is never selected, the
 * write is conditional on the snapshot still being empty, and a lookup that
 * fails again leaves the row exactly as it was — it stays marked, honestly.
 * A price in the base currency is skipped: it needs no rate
 * (`shared/lodgingSpendBase.ts`, rule 1). An undated stay is skipped: a rate
 * is a rate on a day.
 */

/** Rows per pass. Bounded so one large import cannot turn a night into a
 *  request storm against the rate providers; the next night continues. */
export const STAY_FX_BACKFILL_BATCH = 500;

export interface StayFxBackfillResult {
  checked: number;
  filled: number;
  /** Looked up and still without a rate — left marked, untouched. */
  stillMissing: number;
}

export async function backfillMissingStayFx(
  batch = STAY_FX_BACKFILL_BATCH
): Promise<StayFxBackfillResult> {
  const candidates = await prisma.lodgingStay.findMany({
    where: {
      totalPrice: { not: null },
      checkIn: { not: null },
      totalPriceBase: null,
    },
    select: { id: true, userId: true, totalPrice: true, currency: true, checkIn: true },
    orderBy: { createdAt: "asc" },
    take: batch,
  });

  const baseByUser = new Map<string, string>();
  const result: StayFxBackfillResult = { checked: 0, filled: 0, stillMissing: 0 };

  for (const stay of candidates) {
    let base = baseByUser.get(stay.userId);
    if (base === undefined) {
      base = await getBaseCurrency(stay.userId);
      baseByUser.set(stay.userId, base);
    }
    if (stay.currency === base) continue;
    result.checked += 1;

    const outcome = await applyFxSnapshot(
      { totalPrice: stay.totalPrice, currency: stay.currency, checkIn: stay.checkIn },
      base
    );
    if (outcome.status !== "snapshotted") {
      result.stillMissing += 1;
      continue;
    }
    // Conditional on the snapshot still being empty: a user who saved the
    // stay (or typed a rate) while this ran keeps their write.
    const { count } = await prisma.lodgingStay.updateMany({
      where: { id: stay.id, totalPriceBase: null },
      data: outcome.fields,
    });
    result.filled += count;
  }

  if (result.checked > 0) {
    logger.info(
      { operation: "stay_fx_backfill", ...result },
      "Lodging FX backfill: missing snapshots looked up"
    );
  }
  return result;
}
