import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
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

export async function createExpense(
  userId: string,
  scope: ExpenseScope,
  input: CreateExpenseInput
): Promise<ExpenseRow> {
  const target = await resolveTarget(userId, scope, input.routeId);
  await assertStops(userId, target, {
    pinned: input.stopId,
    legEnds: [input.legFromStopId, input.legToStopId],
  });
  return prisma.tripExpense.create({
    data: {
      userId,
      ...target,
      kind: input.kind,
      amount: amountColumn(input.amount),
      currency: input.currency,
      date: dateColumn(input.date ?? null),
      note: input.note ?? null,
      stopId: input.stopId ?? null,
      legFromStopId: input.legFromStopId ?? null,
      legToStopId: input.legToStopId ?? null,
    },
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
): Promise<ExpenseRow> {
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
  const data: Prisma.TripExpenseUncheckedUpdateInput = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.amount !== undefined) data.amount = amountColumn(input.amount);
  if (input.currency !== undefined) data.currency = input.currency;
  if ("date" in input) data.date = dateColumn(input.date ?? null);
  if ("note" in input) data.note = input.note ?? null;
  if ("stopId" in input) data.stopId = input.stopId ?? null;
  if ("legFromStopId" in input) data.legFromStopId = input.legFromStopId ?? null;
  if ("legToStopId" in input) data.legToStopId = input.legToStopId ?? null;
  return prisma.tripExpense.update({ where: { id: row.id }, data, select: EXPENSE_SELECT });
}

export async function deleteExpense(
  userId: string,
  scope: ExpenseScope,
  expenseId: string
): Promise<void> {
  const row = await findOwned(userId, scope, expenseId);
  await prisma.tripExpense.delete({ where: { id: row.id } });
}
