import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { createExpenseSchema, updateExpenseSchema } from "../../schemas/expense";
import { takeDocumentIds } from "../../services/documents/documentService";
import { baseConvertible, toExpenseDto } from "../../services/expenses/expenseDto";
import {
  createExpense,
  deleteExpense,
  findExpense,
  listExpenses,
  updateExpense,
  type ExpenseScope,
} from "../../services/expenses/expenseStore";
import { getBaseCurrency } from "../../services/fx/snapshot";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";
import { createOnce, takeClientRef } from "../../services/sync/clientRef";
import { baseTotal, sumByCurrency } from "../../shared/expenses";
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
 * Bare responses, like every trip and roadtrip router (ADR 0001). A write
 * answers `{ expense, fxSnapshot }`: what became of the exchange rate, the
 * convention of the flight and cruise edits, so a failed lookup reaches the
 * client instead of passing as success (forgejo#150).
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
        const [rows, base] = await Promise.all([
          listExpenses(userId, await resolve(userId, req)),
          getBaseCurrency(userId),
        ]);
        const expenses = rows.map(toExpenseDto);
        res.json({
          expenses,
          totals: sumByCurrency(expenses),
          baseTotal: baseTotal(expenses.map(baseConvertible), base),
        });
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
        // An outbox replay carries the key it minted (forgejo#283): a repeat
        // answers the expense the first POST made, 200 instead of 201. The
        // scope is part of "the same write" — one body on two trips is two —
        // and so are the receipts: a repeat naming other ones is a 409.
        const { clientRef, rest: body } = takeClientRef(req.body);
        const { created, result } = await createOnce({
          userId,
          clientRef,
          kind: "expense",
          payload: { scope, body },
          create: async (claim) => {
            const input = createExpenseSchema.parse(body);
            // Checked BEFORE the write: a foreign or already-filed receipt
            // fails the create rather than leaving an expense without it.
            const documentIds = await takeDocumentIds(userId, body);
            const write = await createExpense(userId, scope, input, { documentIds, claim });
            return { row: write.row, fxSnapshot: write.fx.outcome };
          },
          // Nothing is looked up or filed again for a repeat: the stored rate stands.
          replay: async (id) => {
            const row = await findExpense(userId, scope, id);
            return row ? { row, fxSnapshot: "unchanged" as const } : null;
          },
        });
        if (created) {
          logger.info({
            operation: "expense.create",
            expenseId: result.row.id,
            kind: result.row.kind,
            fx: result.fxSnapshot,
          });
        }
        res
          .status(created ? 201 : 200)
          .json({ expense: toExpenseDto(result.row), fxSnapshot: result.fxSnapshot });
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
        const { row, fx } = await updateExpense(userId, scope, req.params.expenseId, input);
        logger.info({ operation: "expense.update", expenseId: row.id, fx: fx.outcome });
        res.json({ expense: toExpenseDto(row), fxSnapshot: fx.outcome });
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
