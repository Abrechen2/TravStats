import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { batchLimiter } from "../middleware/rateLimit";
import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import {
  changeHistoryQuerySchema,
  changeHistoryRetentionSchema,
  changeIdParamSchema,
} from "../schemas/changeHistory";
import { retentionMonthsFor } from "../services/changeLedger/retention";
import { RETENTION_MONTHS_OPTIONS } from "../services/changeLedger/retentionPolicy";
import { listHistory, restoreChange } from "../services/changeLedger/history";

/**
 * The change history of the account's travel entries (spec
 * `docs/superpowers/specs/2026-11-22-change-history.md`): read one entry's
 * changes, or write one recorded value back. Bare (ADR 0001). Every query is
 * scoped to `req.userId`; a row of another account answers 404.
 */
const router = Router();

/** A restore is a write: a bucket of its own, sized like the other batch edits. */
const changeRestoreLimiter = batchLimiter("Too many restores, please try again later");

router.get("/", authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = changeHistoryQuerySchema.parse(req.query);
    res.json(await listHistory(req.userId!, q));
  } catch (err) {
    next(err);
  }
});

/** How long this account's history is kept, and the choices (Einstellungen → Daten). */
router.get(
  "/retention",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json({
        months: await retentionMonthsFor(req.userId!),
        options: RETENTION_MONTHS_OPTIONS,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/retention",
  authenticate,
  requireWriteScope,
  rejectDemoWrites,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { months } = changeHistoryRetentionSchema.parse(req.body);
      const saved = await prisma.userSettings.updateMany({
        where: { userId: req.userId! },
        data: { changeHistoryRetentionMonths: months },
      });
      if (saved.count === 0) throw new AppError("Settings not found", 404);
      res.json({ months, options: RETENTION_MONTHS_OPTIONS });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/restore",
  authenticate,
  requireWriteScope,
  rejectDemoWrites,
  changeRestoreLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = changeIdParamSchema.parse(req.params);
      res.json({ restored: await restoreChange(req.userId!, id) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
