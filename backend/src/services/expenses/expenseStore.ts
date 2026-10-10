import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { ClaimClientRef } from "../sync/clientRef";
import { linkDocumentsInTx } from "../documents/documentService";
import {
  STATION_OR_LEG_MESSAGE,
  type CreateExpenseInput,
  type UpdateExpenseInput,
} from "../../schemas/expense";
import {
  EXPENSE_ORDER,
  EXPENSE_SELECT,
  amountColumn,
  dateColumn,
  type ExpenseRow,
} from "./expenseDto";
import { expenseFxOnCreate, expenseFxOnUpdate, type ExpenseFxWrite } from "./expenseFx";
import { payerColumns } from "./expensePayer";

/**
 * Reading and writing expenses (forgejo#140) for the two path families: a
 * trip's (`/trips/:id/expenses`) and a section's (`/roadtrips/:id/expenses`,
 * `/tours/:routeId/expenses`). The caller has already resolved the trip or
 * section as the caller's own; everything below re-checks ownership on every
 * row it touches anyway, because a foreign key proves existence, not ownership.
 */

/** Which owner the path names. Resolved and authorised by the router. */
export type ExpenseScope = { kind: "trip"; tripId: string } | { kind: "route"; routeId: string };

/** Where one expense sits: exactly one of the two is set (`trip_expenses_one_scope`). */
interface Target {
  tripId: string | null;
  routeId: string | null;
}

/**
 * A trip's expenses are its own trip-wide ones AND those of its sections: a
 * section's expense is stored on the section, so it moves with a roadtrip
 * that changes trip, and is read through the section's current trip.
 */
export function scopeWhere(userId: string, scope: ExpenseScope): Prisma.TripExpenseWhereInput {
  return scope.kind === "trip"
    ? { userId, OR: [{ tripId: scope.tripId }, { route: { tripId: scope.tripId } }] }
    : { userId, routeId: scope.routeId };
}

const refuse = (message: string): AppError => new AppError(message, 400, "VALIDATION_FAILED");

async function resolveTarget(
  userId: string,
  scope: ExpenseScope,
  routeId: string | null | undefined
): Promise<Target> {
  if (scope.kind === "route") {
    if (routeId != null) throw refuse("This path already names the section; send no routeId");
    return { tripId: null, routeId: scope.routeId };
  }
  if (routeId == null) return { tripId: scope.tripId, routeId: null };
  const route = await prisma.tripRoute.findFirst({
    where: { id: routeId, userId, tripId: scope.tripId },
    select: { id: true },
  });
  if (!route) throw new AppError("Route not found", 404);
  return { tripId: null, routeId: route.id };
}

/**
 * Every named stop must be the caller's, and must belong to the place the
 * expense sits: a section's station for a section's expense, the trip's own
 * stop for a trip-wide one. A pinned STATION may not be a route correction —
 * nobody pays at a bend in the line; a leg end may, because legs run through
 * them (the tolls the migration moved were recorded on such legs).
 */
async function assertStops(
  userId: string,
  target: Target,
  stops: { pinned: string | null | undefined; legEnds: Array<string | null | undefined> }
): Promise<void> {
  const ids = [stops.pinned, ...stops.legEnds].filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await prisma.tripStop.findMany({
    where: { id: { in: unique }, OR: [{ trip: { userId } }, { route: { userId } }] },
    select: { id: true, tripId: true, routeId: true, viaPoint: true },
  });
  if (rows.length !== unique.length) throw new AppError("Station not found", 404);
  for (const row of rows) {
    const inScope =
      target.routeId !== null ? row.routeId === target.routeId : row.tripId === target.tripId;
    if (!inScope) {
      throw refuse(
        target.routeId !== null
          ? "That stop is not a station of this section"
          : "That stop is not on this trip; a section's station takes the section's routeId"
      );
    }
    if (row.id === stops.pinned && row.viaPoint) {
      throw refuse("An expense cannot be pinned to a route correction");
    }
  }
}

export async function listExpenses(userId: string, scope: ExpenseScope): Promise<ExpenseRow[]> {
  return prisma.tripExpense.findMany({
    where: scopeWhere(userId, scope),
    select: EXPENSE_SELECT,
    orderBy: EXPENSE_ORDER,
  });
}

/** One expense as every response carries it — after a write that touched its documents. */
export async function readExpense(expenseId: string): Promise<ExpenseRow> {
  return prisma.tripExpense.findUniqueOrThrow({ where: { id: expenseId }, select: EXPENSE_SELECT });
}

/** A write's row, and what became of its exchange rate. */
export interface ExpenseWrite {
  row: ExpenseRow;
  fx: ExpenseFxWrite;
}

export interface CreateExpenseOptions {
  /**
   * Receipts to file with the new expense (forgejo#150), already checked as
   * the caller's and unfiled (`takeDocumentIds`).
   */
  documentIds?: readonly string[];
  /**
   * The idempotency key's hook (forgejo#283, `services/sync/clientRef.ts`),
   * run inside the creating transaction with the new row's id.
   */
  claim?: ClaimClientRef;
}

/**
 * Everything that can take time or reach the network — the payer's companion
 * and the exchange-rate lookup — runs BEFORE the transaction. The transaction
 * then holds only the row, its receipts and the client key: a key never
 * exists for a half-done write, and a receipt that could not be filed leaves
 * no expense behind.
 */
export async function createExpense(
  userId: string,
  scope: ExpenseScope,
  input: CreateExpenseInput,
  options: CreateExpenseOptions = {}
): Promise<ExpenseWrite> {
  const target = await resolveTarget(userId, scope, input.routeId);
  await assertStops(userId, target, {
    pinned: input.stopId,
    legEnds: [input.legFromStopId, input.legToStopId],
  });
  const payer = await payerColumns(userId, input.payer);
  const amount = amountColumn(input.amount);
  const date = dateColumn(input.date ?? null);
  const fx = await expenseFxOnCreate(
    userId,
    { amount: amount.toNumber(), currency: input.currency, date },
    input.fx
  );
  const documentIds = [...new Set(options.documentIds ?? [])];
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.tripExpense.create({
      data: {
        userId,
        ...target,
        kind: input.kind,
        amount,
        currency: input.currency,
        date,
        note: input.note ?? null,
        stopId: input.stopId ?? null,
        legFromStopId: input.legFromStopId ?? null,
        legToStopId: input.legToStopId ?? null,
        ...payer,
        ...fx.columns,
      },
      select: { id: true },
    });
    const entry = { type: "tripExpense" as const, id: created.id };
    if ((await linkDocumentsInTx(tx, userId, documentIds, entry)) !== documentIds.length) {
      // Filed elsewhere since the check: throwing rolls the expense (and the key) back.
      throw new AppError("A receipt is already filed with another entry", 409);
    }
    await options.claim?.(tx, created.id);
    return tx.tripExpense.findUniqueOrThrow({ where: { id: created.id }, select: EXPENSE_SELECT });
  });
  return { row, fx };
}

/** One expense of the scope, or null — a repeat create's answer (forgejo#283). */
export async function findExpense(
  userId: string,
  scope: ExpenseScope,
  expenseId: string
): Promise<ExpenseRow | null> {
  return prisma.tripExpense.findFirst({
    where: { AND: [{ id: expenseId }, scopeWhere(userId, scope)] },
    select: EXPENSE_SELECT,
  });
}

async function findOwned(userId: string, scope: ExpenseScope, expenseId: string) {
  const row = await prisma.tripExpense.findFirst({
    where: { AND: [{ id: expenseId }, scopeWhere(userId, scope)] },
    select: {
      id: true,
      tripId: true,
      routeId: true,
      stopId: true,
      legFromStopId: true,
      legToStopId: true,
      amount: true,
      currency: true,
      date: true,
      amountBase: true,
      fxRate: true,
      fxRateDate: true,
      fxBaseCurrency: true,
      fxSource: true,
    },
  });
  if (!row) throw new AppError("Expense not found", 404);
  return row;
}

/**
 * PATCH. Zod drops an absent optional key, so `in` tells "leave it" from
 * "clear it" — `body.x ?? row.x` could not, and would keep a value the client
 * asked to clear.
 */
export async function updateExpense(
  userId: string,
  scope: ExpenseScope,
  expenseId: string,
  input: UpdateExpenseInput
): Promise<ExpenseWrite> {
  const row = await findOwned(userId, scope, expenseId);
  const after = {
    stopId: "stopId" in input ? (input.stopId ?? null) : row.stopId,
    legFromStopId: "legFromStopId" in input ? (input.legFromStopId ?? null) : row.legFromStopId,
  };
  if (after.stopId !== null && after.legFromStopId !== null) {
    throw refuse(STATION_OR_LEG_MESSAGE);
  }
  await assertStops(
    userId,
    { tripId: row.tripId, routeId: row.routeId },
    { pinned: input.stopId, legEnds: [input.legFromStopId, input.legToStopId] }
  );
  const payer = await payerColumns(userId, input.payer);
  const next = {
    amount: input.amount !== undefined ? amountColumn(input.amount) : row.amount,
    currency: input.currency ?? row.currency,
    date: "date" in input ? dateColumn(input.date ?? null) : row.date,
  };
  const fx = await expenseFxOnUpdate(
    userId,
    { ...row, amount: row.amount.toNumber(), amountBase: row.amountBase?.toNumber() ?? null },
    { ...next, amount: next.amount.toNumber() },
    input.fx,
    { expenseId: row.id, userId }
  );
  const data: Prisma.TripExpenseUncheckedUpdateInput = { ...payer, ...fx.columns };
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.amount !== undefined) data.amount = next.amount;
  if (input.currency !== undefined) data.currency = input.currency;
  if ("date" in input) data.date = next.date;
  if ("note" in input) data.note = input.note ?? null;
  if ("stopId" in input) data.stopId = input.stopId ?? null;
  if ("legFromStopId" in input) data.legFromStopId = input.legFromStopId ?? null;
  if ("legToStopId" in input) data.legToStopId = input.legToStopId ?? null;
  const updated = await prisma.tripExpense.update({
    where: { id: row.id },
    data,
    select: EXPENSE_SELECT,
  });
  return { row: updated, fx };
}

export async function deleteExpense(
  userId: string,
  scope: ExpenseScope,
  expenseId: string
): Promise<void> {
  const row = await findOwned(userId, scope, expenseId);
  await prisma.tripExpense.delete({ where: { id: row.id } });
}
