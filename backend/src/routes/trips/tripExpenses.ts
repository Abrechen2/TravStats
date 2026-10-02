import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { createExpenseSchema, updateExpenseSchema } from "../../schemas/expense";
import { toExpenseDto } from "../../services/expenses/expenseDto";
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
  type ExpenseScope,
} from "../../services/expenses/expenseStore";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";
import { sumByCurrency } from "../../shared/expenses";
import logger from "../../utils/logger";
import { resolveTrip } from "./resolveTrip";
import { resolveRoute } from "./tourRoutes";

/**
 * Expenses (forgejo#140, owner 2026-10-01): a ferry ticket, a toll, a pitch
 * fee, fuel. Three path families over one store, because an expense sits on a
 * trip OR on a section and a standalone roadtrip has no trip to be reached
 * through:
 *
 * - `/trips/:id/expenses` — the trip's own AND its sections'. A POST lands on
 *   the trip, or on one of its sections when the body names `routeId`.
 * - `/roadtrips/:id/expenses` — a roadtrip's (404 for a tour id).
 * - `/tours/:routeId/expenses` — any section's, the kind-agnostic family the
 *   legs live under; a standalone tour's tolls moved here from its legs.
 *
 * Bare responses, like every trip and roadtrip router (ADR 0001).
 */

const router = Router();

type ScopeResolver = (userId: string, req: AuthRequest) => Promise<ExpenseScope>;

const FAMILIES: Array<{ base: string; resolve: ScopeResolver }> = [
  {
    base: "/trips/:id/expenses",
    resolve: async (userId, req) => ({
      kind: "trip",
      tripId: (await resolveTrip(userId, req.params.id)).id,
    }),
  },
  {
    base: "/roadtrips/:id/expenses",
    resolve: async (userId, req) => ({
      kind: "route",
      routeId: await resolveRoadtrip(userId, req.params.id),
    }),
  },
  {
    base: "/tours/:routeId/expenses",
    resolve: async (userId, req) => ({
      kind: "route",
      routeId: await resolveRoute(userId, undefined, req.params.routeId),
    }),
  },
];

for (const { base, resolve } of FAMILIES) {
  router.get(
    base,
    authenticate,
    requireWriteScope,
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.userId!;
        const rows = await listExpenses(userId, await resolve(userId, req));
        const expenses = rows.map(toExpenseDto);
        res.json({ expenses, totals: sumByCurrency(expenses) });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    base,
    authenticate,
    requireWriteScope,
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.userId!;
        const scope = await resolve(userId, req);
        const row = await createExpense(userId, scope, createExpenseSchema.parse(req.body));
        logger.info({ operation: "expense.create", expenseId: row.id, kind: row.kind });
        res.status(201).json({ expense: toExpenseDto(row) });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    `${base}/:expenseId`,
    authenticate,
    requireWriteScope,
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.userId!;
        const scope = await resolve(userId, req);
        const input = updateExpenseSchema.parse(req.body);
        const row = await updateExpense(userId, scope, req.params.expenseId, input);
        logger.info({ operation: "expense.update", expenseId: row.id });
        res.json({ expense: toExpenseDto(row) });
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    `${base}/:expenseId`,
    authenticate,
    requireWriteScope,
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.userId!;
        await deleteExpense(userId, await resolve(userId, req), req.params.expenseId);
        logger.info({ operation: "expense.delete", expenseId: req.params.expenseId });
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );
}

export default router;
