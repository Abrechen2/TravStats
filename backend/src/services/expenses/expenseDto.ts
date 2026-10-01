import { Prisma } from "../../prisma";
import type { ExpenseDto } from "../../schemas/expense";
import type { ExpenseKind } from "../../shared/expenses";
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
