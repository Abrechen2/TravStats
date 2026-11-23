import { Router, Response, NextFunction } from "express";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { settingsLimiter } from "../middleware/rateLimit";
import { prisma } from "../db";
import { invitationSeenBodySchema, snoozeBodySchema } from "../schemas/readiness";
import {
  buildReadinessAttention,
  buildReadinessView,
  invitationKeys,
  findApplicableItem,
  findApplicableNote,
} from "../services/readiness/evaluate";
import {
  acknowledgeNote,
  addInvitationSeen,
  clearItemState,
  markInvitationSeen,
  setItemState,
  snoozeInvitation,
  SNOOZE_DEFAULT_MS,
  SNOOZE_MAX_MS,
} from "../services/readiness/state";
import { ENTRY_LIST_LIMIT, problemRuleOf } from "../services/readiness/problemEntries";

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

/**
 * Admin items are for an admin session. A token needs the admin scope on top of the
 * flag, as in `requireAdmin`: a read or write token of an admin sees (and changes)
 * what an ordinary account would.
 */
async function callerIsAdmin(req: AuthRequest): Promise<boolean> {
  if (req.apiToken && req.apiToken.scope !== "admin") return false;
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { isAdmin: true },
  });
  return user?.isAdmin === true;
}

function itemNotFound(): AppError {
  return new AppError("No such readiness item", 404, "READINESS_ITEM_NOT_FOUND");
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    res.json(await buildReadinessView(userId, await callerIsAdmin(req)));
  } catch (error) {
    next(error);
  }
});

// The header dot: counts only, nothing written (owner, 2026-11-23).
router.get(
  "/attention",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await buildReadinessAttention(req.userId!, await callerIsAdmin(req)));
    } catch (error) {
      next(error);
    }
  }
);

// What a data check found, each entry with its own page.
router.get(
  "/items/:id/entries",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const check = await findApplicableItem(req.userId!, await callerIsAdmin(req), id);
      const rule = check?.entryList ? problemRuleOf(id) : null;
      if (!rule) throw itemNotFound();
      const [total, entries] = await Promise.all([
        rule.count(req.userId!),
        rule.list(req.userId!, ENTRY_LIST_LIMIT),
      ]);
      res.json({ total, entries });
    } catch (error) {
      next(error);
    }
  }
);

// The page marks what the card showed as seen; "Morgen erinnern" hides the card for a day.
router.post(
  "/invitation/seen",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = invitationSeenBodySchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError("Invalid seen request", 400, undefined, "keys");
      const view = await buildReadinessView(req.userId!, await callerIsAdmin(req));
      const { noteKeys, itemKeys } = invitationKeys(view.items, view.notes);
      const current = [...noteKeys, ...itemKeys];
      if (body.data.keys) await addInvitationSeen(req.userId!, body.data.keys, current);
      else await markInvitationSeen(req.userId!, current);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/invitation/snooze",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await snoozeInvitation(req.userId!, new Date(Date.now() + SNOOZE_DEFAULT_MS));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/items/:id/snooze",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = snoozeBodySchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError("Invalid snooze request", 400, undefined, "until");
      const userId = req.userId!;
      const check = await findApplicableItem(userId, await callerIsAdmin(req), req.params.id);
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
      const check = await findApplicableItem(userId, await callerIsAdmin(req), req.params.id);
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
      const check = await findApplicableItem(userId, await callerIsAdmin(req), req.params.id);
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
      if (!(await findApplicableNote(userId, await callerIsAdmin(req), req.params.id))) {
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
