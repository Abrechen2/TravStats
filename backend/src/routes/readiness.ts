import { Router, Response, NextFunction } from "express";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { settingsLimiter } from "../middleware/rateLimit";
import { prisma } from "../db";
import { snoozeBodySchema } from "../schemas/readiness";
import {
  buildReadinessView,
  findApplicableItem,
  findApplicableNote,
} from "../services/readiness/evaluate";
import {
  acknowledgeNote,
  clearItemState,
  setItemState,
  SNOOZE_DEFAULT_MS,
  SNOOZE_MAX_MS,
} from "../services/readiness/state";

/**
 * Setup & readiness (`/api/v1/readiness`, spec 2026-11-14 §11). Bare response
 * family (ADR 0001). The page is evaluated from stored state only — it may be
 * opened often and never calls out. An admin item reaches admins alone: for an
 * ordinary account it is 404, exactly as an id that does not exist.
 *
 * The shared demo account reads its own items; every write is refused
 * (`rejectDemoWrites`).
 */
const router = Router();

router.use(settingsLimiter);
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);

async function callerIsAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin === true;
}

function itemNotFound(): AppError {
  return new AppError("No such readiness item", 404, "READINESS_ITEM_NOT_FOUND");
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    res.json(await buildReadinessView(userId, await callerIsAdmin(userId)));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/items/:id/snooze",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = snoozeBodySchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError("Invalid snooze request", 400, undefined, "until");
      const userId = req.userId!;
      const check = await findApplicableItem(userId, await callerIsAdmin(userId), req.params.id);
      if (!check) throw itemNotFound();
      const now = Date.now();
      const until = body.data.until ? new Date(body.data.until) : new Date(now + SNOOZE_DEFAULT_MS);
      if (until.getTime() <= now || until.getTime() > now + SNOOZE_MAX_MS) {
        throw new AppError("A snooze ends within the next 30 days", 400, undefined, "until");
      }
      await setItemState(userId, check.id, check.revision, "snoozed", until);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/items/:id/opt-out",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const check = await findApplicableItem(userId, await callerIsAdmin(userId), req.params.id);
      if (!check) throw itemNotFound();
      if (check.severity === "required") {
        throw new AppError(
          "A required item cannot be opted out of",
          409,
          "READINESS_OPT_OUT_NOT_ALLOWED"
        );
      }
      await setItemState(userId, check.id, check.revision, "optedOut", null);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/items/:id/state",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const check = await findApplicableItem(userId, await callerIsAdmin(userId), req.params.id);
      if (!check) throw itemNotFound();
      await clearItemState(userId, check.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/notes/:id/ack",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      if (!(await findApplicableNote(userId, await callerIsAdmin(userId), req.params.id))) {
        throw new AppError("No such update note", 404, "READINESS_NOTE_NOT_FOUND");
      }
      await acknowledgeNote(userId, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
