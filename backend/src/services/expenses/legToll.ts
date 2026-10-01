import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { EXPENSE_SELECT, amountColumn, dateColumn, type ExpenseRow } from "./expenseDto";
import { storedDay } from "../tripSuggestions/time";

/**
 * The leg PUT's `tollCost` / `currency`, kept for existing clients after the
 * toll moved off the leg (forgejo#140, owner 2026-10-01: one source of truth
 * for totals). The two fields no longer have a column; they read and write the
 * leg's TOLL EXPENSE — the one `TripExpense` of kind `toll` on this section
 * between exactly these two stops, which is what the migration made of every
 * stored toll.
 *
 * - `tollCost: <n>` creates it, or updates its amount. Its currency is the
 *   body's, else the one it already has, else the owner's base currency — a
 *   leg used to accept a toll without one, an expense cannot exist without one.
 *   A new one is dated the day the leg leaves its first stop, the rule the
 *   migration used.
 * - `tollCost: null` deletes it: the old "clear the toll".
 * - `currency` alone re-labels an existing one and is otherwise a no-op —
 *   there is no amount for it to belong to. `currency: null` alone changes
 *   nothing: an expense keeps its currency.
 * - Several toll expenses on one leg (made through `/expenses`) have no single
 *   "the toll" to edit: 409, rather than guessing which one the client meant.
 */

export interface LegTollInput {
  tollCost?: number | null;
  currency?: string | null;
}

export interface LegRef {
  userId: string;
  routeId: string;
  fromStopId: string;
  toStopId: string;
}

type Tx = DbTransaction;

export function touchesToll(body: LegTollInput): boolean {
  return "tollCost" in body || "currency" in body;
}

async function legDay(tx: Tx, ref: LegRef): Promise<string | null> {
  const stops = await tx.tripStop.findMany({
    where: { id: { in: [ref.fromStopId, ref.toStopId] } },
    select: { id: true, startDate: true, endDate: true },
  });
  const from = stops.find((s) => s.id === ref.fromStopId);
  const to = stops.find((s) => s.id === ref.toStopId);
  const day = from?.endDate ?? from?.startDate ?? to?.startDate ?? null;
  return day ? storedDay(day) : null;
}

async function baseCurrency(tx: Tx, userId: string): Promise<string> {
  const settings = await tx.userSettings.findUnique({
    where: { userId },
    select: { baseCurrency: true },
  });
  return settings?.baseCurrency ?? "EUR";
}

/** Apply the body's toll fields; returns the leg's toll expense afterwards, or null. */
export async function applyLegToll(
  tx: Tx,
  ref: LegRef,
  body: LegTollInput
): Promise<ExpenseRow | null> {
  const where = {
    userId: ref.userId,
    routeId: ref.routeId,
    kind: "toll",
    legFromStopId: ref.fromStopId,
    legToStopId: ref.toStopId,
  };
  const existing = await tx.tripExpense.findMany({ where, select: EXPENSE_SELECT });
  if (existing.length > 1) {
    throw new AppError(
      "This leg carries several toll expenses; change them through the expenses endpoints",
      409
    );
  }
  const current = existing[0] ?? null;
  const currency = typeof body.currency === "string" ? body.currency : undefined;

  if ("tollCost" in body && body.tollCost === null) {
    if (current) await tx.tripExpense.delete({ where: { id: current.id } });
    return null;
  }
  if (typeof body.tollCost === "number") {
    if (current) {
      return tx.tripExpense.update({
        where: { id: current.id },
        data: { amount: amountColumn(body.tollCost), ...(currency ? { currency } : {}) },
        select: EXPENSE_SELECT,
      });
    }
    return tx.tripExpense.create({
      data: {
        ...where,
        amount: amountColumn(body.tollCost),
        currency: currency ?? (await baseCurrency(tx, ref.userId)),
        date: dateColumn(await legDay(tx, ref)),
      },
      select: EXPENSE_SELECT,
    });
  }
  if (current && currency) {
    return tx.tripExpense.update({
      where: { id: current.id },
      data: { currency },
      select: EXPENSE_SELECT,
    });
  }
  return current;
}
