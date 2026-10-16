/**
 * An expense's exchange-rate record (forgejo#150) — when it is written, kept,
 * re-priced or cleared. The lookups are not here: a live rate comes from
 * `fx/snapshot.ts` (`snapshotFx`), and an edit goes through the one edit rule
 * in `fx/refreshOnEdit.ts`, exactly as a flight's or a cruise's does. What is
 * the expense's own is a rate the CLIENT brings — the Companion's offline
 * table (`cached`) or one the user typed (`manual`) — and an explicit removal.
 *
 * The rules:
 * - A supplied `fx` is stored as given, re-priced to the base currency's minor
 *   unit. It wins on create and on update.
 * - `fx: null` removes the record (and on create means: look nothing up).
 * - Otherwise a create of a dated expense looks a rate up for its day; an
 *   undated one gets none — a rate is a rate ON A DAY.
 * - Otherwise an update touches the record only when amount, currency or day
 *   moved. A note, a kind or a payer change leaves a stored rate — manual or
 *   cached included — exactly as it was. When an input did move and the
 *   lookup fails, the stored rate re-prices the new amount if it still
 *   converts the same currency into the same base; else the record goes.
 *
 * A failed lookup is never silent: every write reports its `ExpenseFxOutcome`.
 */
import { AppError } from "../../middleware/errorHandler";
import { Prisma } from "../../prisma";
import type { CreateExpenseInput, ExpenseFxOutcome } from "../../schemas/expense";
import { minorUnits } from "../../shared/currencies";
import type { FxColumns } from "../fx/snapshot";
import { getBaseCurrency, snapshotFx } from "../fx/snapshot";
import { refreshFxOnEdit } from "../fx/refreshOnEdit";
import { dayColumn } from "../tripSuggestions/time";

/** The five columns as `trip_expenses` names them. */
export interface ExpenseFxColumns {
  amountBase: Prisma.Decimal | null;
  fxRate: number | null;
  fxRateDate: Date | null;
  fxBaseCurrency: string | null;
  fxSource: string | null;
}

export const CLEARED_EXPENSE_FX: ExpenseFxColumns = {
  amountBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  fxSource: null,
};

export type SuppliedFx = NonNullable<CreateExpenseInput["fx"]>;

export interface ExpenseFxWrite {
  columns: Partial<ExpenseFxColumns>;
  outcome: ExpenseFxOutcome;
}

/** The three inputs a rate converts, as the columns hold them. */
export interface ExpenseFxInputs {
  amount: number;
  currency: string;
  date: Date | null;
}

/**
 * In Decimal, half-up: in binary floating point 1.005 × 100 is
 * 100.49999999999999, so `Math.round(amount * rate * factor)` turned half a
 * cent down.
 */
function priced(amount: number, rate: number, baseCurrency: string): Prisma.Decimal {
  return new Prisma.Decimal(amount)
    .times(new Prisma.Decimal(rate))
    .toDecimalPlaces(minorUnits(baseCurrency), Prisma.Decimal.ROUND_HALF_UP);
}

function suppliedColumns(fx: SuppliedFx, inputs: ExpenseFxInputs): ExpenseFxColumns {
  // A currency converts into itself at 1. Anything else is a typo, and storing
  // it would make a base-currency expense count as some other amount.
  if (fx.baseCurrency === inputs.currency && fx.rate !== 1) {
    throw new AppError("A rate from a currency into itself is 1", 400, "VALIDATION_FAILED");
  }
  return {
    amountBase: priced(inputs.amount, fx.rate, fx.baseCurrency),
    fxRate: fx.rate,
    fxRateDate: dayColumn(fx.rateDate),
    fxBaseCurrency: fx.baseCurrency,
    fxSource: fx.source,
  };
}

/** `fx/snapshot.ts`'s generic columns under this table's names. */
function fromFxColumns(columns: Partial<FxColumns>): Partial<ExpenseFxColumns> {
  const { priceBase, ...rest } = columns;
  return {
    ...rest,
    ...(priceBase !== undefined && {
      amountBase: priceBase === null ? null : new Prisma.Decimal(priceBase),
    }),
  };
}

export async function expenseFxOnCreate(
  userId: string,
  inputs: ExpenseFxInputs,
  fx: SuppliedFx | null | undefined
): Promise<ExpenseFxWrite> {
  if (fx) return { columns: suppliedColumns(fx, inputs), outcome: "supplied" };
  if (fx === null) return { columns: CLEARED_EXPENSE_FX, outcome: "removed" };
  if (inputs.date === null) return { columns: CLEARED_EXPENSE_FX, outcome: "undated" };
  const snapshot = await snapshotFx(inputs, await getBaseCurrency(userId));
  if (snapshot.status !== "snapshotted") {
    return {
      columns: CLEARED_EXPENSE_FX,
      outcome: snapshot.status === "missingDate" ? "undated" : "lookupFailed",
    };
  }
  return {
    outcome: "snapshotted",
    columns: {
      amountBase: new Prisma.Decimal(snapshot.snapshot.baseAmount),
      fxRate: snapshot.snapshot.rate,
      fxRateDate: snapshot.snapshot.rateDate,
      fxBaseCurrency: snapshot.snapshot.baseCurrency,
      fxSource: snapshot.snapshot.source,
    },
  };
}

/** The stored row's inputs and record, with numbers as numbers. */
export interface StoredExpenseFx extends ExpenseFxInputs {
  amountBase: number | null;
  fxRate: number | null;
  fxRateDate: Date | null;
  fxBaseCurrency: string | null;
  fxSource: string | null;
}

export async function expenseFxOnUpdate(
  userId: string,
  stored: StoredExpenseFx,
  next: ExpenseFxInputs,
  fx: SuppliedFx | null | undefined,
  context: Record<string, unknown>
): Promise<ExpenseFxWrite> {
  if (fx) return { columns: suppliedColumns(fx, next), outcome: "supplied" };
  if (fx === null) return { columns: CLEARED_EXPENSE_FX, outcome: "removed" };
  const refresh = await refreshFxOnEdit(
    { ...stored, priceBase: stored.amountBase },
    next,
    await getBaseCurrency(userId),
    { ...context, domain: "trip_expense" }
  );
  // `cleared` means the inputs leave nothing to convert; an expense always has
  // an amount and a currency, so that can only be a missing day.
  const outcome = refresh.outcome === "cleared" ? "undated" : refresh.outcome;
  return { columns: fromFxColumns(refresh.columns), outcome };
}

/**
 * The row note a spreadsheet import leaves when the rate could not be looked
 * up — the codes the flight and cruise sheets already use (`xlsxImport/fxSnapshot.ts`).
 */
export function expenseFxNote(outcome: ExpenseFxOutcome): string | null {
  if (outcome === "keptStoredRate") return "fx_kept_stored_rate";
  if (outcome === "lookupFailed") return "fx_lookup_failed";
  return null;
}
