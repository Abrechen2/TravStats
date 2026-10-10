import { Prisma } from "../../prisma";
import type { ExpenseDto, ExpenseFxDto } from "../../schemas/expense";
import type { BaseConvertible, ExpenseFxSource, ExpenseKind } from "../../shared/expenses";
import { dayColumn, storedDay } from "../tripSuggestions/time";
import { EXPENSE_AMOUNT_SCALE } from "../../shared/expenses";

/** The columns every expense read selects. */
export const EXPENSE_SELECT = {
  id: true,
  tripId: true,
  routeId: true,
  stopId: true,
  legFromStopId: true,
  legToStopId: true,
  kind: true,
  amount: true,
  currency: true,
  date: true,
  note: true,
  payerCompanionId: true,
  payerName: true,
  // Read live, so a renamed companion is shown by its current name.
  payerCompanion: { select: { displayName: true } },
  amountBase: true,
  fxRate: true,
  fxRateDate: true,
  fxBaseCurrency: true,
  fxSource: true,
  _count: { select: { documents: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export type ExpenseRow = Prisma.TripExpenseGetPayload<{ select: typeof EXPENSE_SELECT }>;

/** Dated by day, undated last, ties by creation — the order every list answers in. */
export const EXPENSE_ORDER: Prisma.TripExpenseOrderByWithRelationInput[] = [
  { date: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
];

/** The five exchange-rate columns, or null — `trip_expenses_fx_complete` keeps them all-or-none. */
function fxOf(row: ExpenseRow): ExpenseFxDto | null {
  if (
    row.amountBase === null ||
    row.fxRate === null ||
    row.fxRateDate === null ||
    row.fxBaseCurrency === null ||
    row.fxSource === null
  ) {
    return null;
  }
  return {
    amountBase: row.amountBase.toNumber(),
    rate: row.fxRate,
    rateDate: storedDay(row.fxRateDate),
    baseCurrency: row.fxBaseCurrency,
    source: row.fxSource as ExpenseFxSource,
  };
}

/**
 * The companion's current name while it is linked; the name stored with the
 * expense once it is gone (the FK sets the id null, the name stays).
 */
function payerOf(row: ExpenseRow): ExpenseDto["payer"] {
  const name = row.payerCompanion?.displayName ?? row.payerName;
  if (name === null) return null;
  return { companionId: row.payerCompanionId, name };
}

export function toExpenseDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    tripId: row.tripId,
    routeId: row.routeId,
    stopId: row.stopId,
    legFromStopId: row.legFromStopId,
    legToStopId: row.legToStopId,
    kind: row.kind as ExpenseKind,
    amount: row.amount.toNumber(),
    currency: row.currency,
    // A DATE column comes back as UTC midnight of the stored day: its UTC
    // date IS the local day (ADR 0002, D1).
    date: row.date ? storedDay(row.date) : null,
    note: row.note,
    payer: payerOf(row),
    fx: fxOf(row),
    documentCount: row._count.documents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** An expense DTO as `baseTotal` reads it. */
export function baseConvertible(dto: ExpenseDto): BaseConvertible {
  return {
    amount: dto.amount,
    currency: dto.currency,
    amountBase: dto.fx?.amountBase ?? null,
    fxBaseCurrency: dto.fx?.baseCurrency ?? null,
  };
}

/** A request amount as the column stores it: four decimals, exactly. */
export function amountColumn(amount: number): Prisma.Decimal {
  return new Prisma.Decimal(amount).toDecimalPlaces(EXPENSE_AMOUNT_SCALE);
}

/** A request day ("YYYY-MM-DD" or null) as the DATE column takes it. */
export function dateColumn(day: string | null): Date | null {
  return day === null ? null : dayColumn(day);
}
