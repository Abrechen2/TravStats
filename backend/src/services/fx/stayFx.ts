/**
 * The foreign-exchange snapshot a lodging stay carries.
 *
 * Moved out of `routes/lodging.ts` on 2026-09-15. It was never routing: it
 * turns a price, a currency and a date into the five stored columns, and both
 * the stay routes and `lodgingImportCommit` need it. Living under `routes/`
 * also made the response-shape ratchet ask which family it answered in, which
 * is a question a helper has no answer to.
 */

import * as fx from "./resolver";
import { snapshotFx } from "./snapshot";
import { minorUnits } from "../../shared/currencies";
import { AppError } from "../../middleware/errorHandler";

export interface FxSnapshotFields {
  totalPriceBase: number | null;
  fxRate: number | null;
  fxRateDate: Date | null;
  fxBaseCurrency: string | null;
  /** Which provider produced the snapshot — never inferred from the rate. */
  fxSource: fx.RateSource | null;
}

const CLEARED_FX: FxSnapshotFields = {
  totalPriceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  fxSource: null,
};

/**
 * Snapshot the FX conversion for a stay write (spec §7.1). A stay is billed
 * in the hotel's local currency, but the user wants cross-stay totals in one
 * base currency — every write snapshots the ECB rate for the check-in day.
 *
 * `input.checkIn` is always a full ISO-8601 UTC instant by the time it
 * reaches here: on create it's the Zod-validated string from
 * `schemas/lodging.ts` (`isoDateTimeRequired` normalizes any partial input to
 * `.toISOString()`); on a selective-refresh update it's a Prisma `DateTime`
 * read back from the DB, which is likewise stored as a real UTC instant.
 * `new Date(input.checkIn)` therefore reproduces that exact instant without
 * any local-timezone reinterpretation, so `convertToBase`'s internal
 * `date.toISOString().slice(0, 10)` reads the intended check-in calendar day
 * — never shifted by ±1 day the way it would be if we built the Date from a
 * bare "YYYY-MM-DD" string via local-midnight parsing.
 *
 * Never throws — a failed FX lookup clears the snapshot instead of failing
 * the request, so the user always keeps their stay record.
 *
 * Returns a discriminated result rather than collapsing every non-value
 * outcome into the same all-null `FxSnapshotFields` object (finding 1): a
 * caller that already has an EXISTING snapshot on file (a PATCH) needs to
 * tell "the price was explicitly removed — clear it" apart from "the ECB
 * lookup merely failed for this attempt" for logging/observability, even
 * though both still resolve to a null snapshot once the inputs themselves
 * have genuinely changed (see `resolveFxFields` at each call site).
 */
export type FxSnapshotOutcome =
  | { status: "priceRemoved" }
  | { status: "missingCurrency" }
  | { status: "lookupFailed" }
  | { status: "snapshotted"; fields: FxSnapshotFields };

export async function applyFxSnapshot(
  input: { totalPrice?: number | null; currency?: string | null; checkIn?: string | Date | null },
  baseCurrency: string,
): Promise<FxSnapshotOutcome> {
  // Thin adapter over the domain-neutral core in `services/fx/snapshot.ts`
  // (#267): the rule is shared with flights and bookings, the COLUMN NAMES are
  // this domain's. `missingDate` maps onto the same `lookupFailed` the callers
  // already handle — an undated stay has always been treated as "no rate to be
  // had", and splitting that here would change behaviour this move must not.
  const outcome = await snapshotFx(
    { amount: input.totalPrice, currency: input.currency, date: input.checkIn },
    baseCurrency,
  );
  switch (outcome.status) {
    case "amountRemoved":
      return { status: "priceRemoved" };
    case "missingDate":
      return { status: "lookupFailed" };
    case "missingCurrency":
      return { status: "missingCurrency" };
    case "lookupFailed":
      return { status: "lookupFailed" };
    case "snapshotted":
      return {
        status: "snapshotted",
        fields: {
          totalPriceBase: outcome.snapshot.baseAmount,
          fxRate: outcome.snapshot.rate,
          fxRateDate: outcome.snapshot.rateDate,
          fxBaseCurrency: outcome.snapshot.baseCurrency,
          fxSource: outcome.snapshot.source,
        },
      };
  }
}

/**
 * Resolves an `FxSnapshotOutcome` to the fields a write should apply.
 * `priceRemoved`/`missingCurrency`/`lookupFailed` all collapse to `CLEARED_FX`
 * here — they differ for the CALLER (only `missingCurrency` says the amount
 * itself is unusable), but none of them yields a snapshot. They collapse because
 * both call sites only ever invoke `applyFxSnapshot` once the FX-relevant
 * inputs have ALREADY been confirmed to differ from what's stored (see
 * `fxInputsChanged` in the PATCH handler) — at that point a stale snapshot
 * would misrepresent the NEW price/currency/date, so null is the only
 * honest value, matching a genuine price removal.
 */
export function resolveFxFields(outcome: FxSnapshotOutcome): FxSnapshotFields {
  return outcome.status === "snapshotted" ? outcome.fields : CLEARED_FX;
}

/**
 * Apply a rate the user typed in.
 *
 * The contract is narrow on purpose. A manual rate is for the GAP — a currency
 * and day no provider covers — not for disagreeing with the ECB, so supplying
 * one where an automatic rate exists is a mistake worth naming rather than
 * silently preferring or silently dropping. And whatever it produces is marked
 * `manual`, because the UI must never present an estimate as an official rate.
 */
export function applyManualRate(
  auto: FxSnapshotOutcome,
  manualFxRate: number,
  totalPrice: number | null,
  checkIn: string | Date,
  baseCurrency: string,
): FxSnapshotFields {
  if (auto.status === "snapshotted") {
    throw new AppError("A rate is already available for this currency and date", 400);
  }
  // No price means nothing to convert — the rate is moot rather than wrong, so
  // the stay simply keeps no snapshot instead of the request failing.
  if (totalPrice == null) return CLEARED_FX;
  const factor = 10 ** minorUnits(baseCurrency);
  return {
    totalPriceBase: Math.round(totalPrice * manualFxRate * factor) / factor,
    fxRate: manualFxRate,
    fxRateDate: new Date(checkIn),
    fxBaseCurrency: baseCurrency,
    fxSource: "manual",
  };
}
