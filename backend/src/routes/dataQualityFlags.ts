import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { statsLimiter } from "../middleware/rateLimit";
import {
  dataQualityFlagIdParamSchema,
  listDataQualityFlagsQuerySchema,
} from "../schemas/dataQualityFlag";
import { answerGuardBodySchema, resolveFindingBodySchema } from "../schemas/dataQualityFindings";
import {
  dismissFinding,
  FindingActionError,
  getFlagView,
  listFlags,
  resolveFinding,
  runDataQualityChecks,
  undoFinding,
} from "../services/dataQuality";
import logger from "../utils/logger";

/**
 * The data-quality inbox (`/api/v1/data-quality-flags`).
 *
 * Owner's decision, 2026-09-02 ("Unplausible Sachen markieren und in den
 * Posteingang", design §3.5). A record whose own two sources disagree is
 * WRITTEN, flagged, and the question queued — never refused. Nothing this router
 * exposes changes a figure: resolving or dismissing a flag answers a question
 * about a record, it does not edit the record, and counting continues under the
 * stated rule the whole time.
 *
 * It is a sibling of `/pending-updates`, not a replacement: that one carries a
 * provider's proposed field values for a FLIGHT, this one carries a question
 * about any record. The UI shows one Posteingang; the two are separate tables
 * because they are separate things.
 *
 * Auth mirrors `pendingUpdates.ts`: everything is authenticated, and
 * `requireWriteScope` is method-aware so a read-only PAT keeps the list and is
 * refused the answers.
 */

const router = Router();

router.use(authenticate);
// GET passes through; POST needs write scope. Answering a flag is a decision
// about the user's data, and re-running the checks writes rows.
router.use(requireWriteScope);

/**
 * The open questions.
 *
 * `status` defaults to `open` because that is what an inbox is. `all` is there
 * so the answers already given can be reviewed without a second endpoint —
 * particularly `dismissed`, which is the only permanent answer and therefore the
 * one a user may want to take back.
 */
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { status, kind } = listDataQualityFlagsQuerySchema.parse(req.query);

    const flags = await listFlags(userId, { status, kind });

    res.json({ flags, count: flags.length });
  } catch (error) {
    next(error);
  }
});

/**
 * Re-run every check for the calling account.
 *
 * Registered before the `/:id/...` routes so the literal path wins.
 *
 * Rate-limited on the stats bucket because it costs the same kind of thing: one
 * request reads the account's whole lodging, place, flight and port-call set
 * instead of touching one row. Safe to call repeatedly — the run reconciles
 * rather than inserts, so a second call over unchanged data writes nothing.
 */
router.post("/run", statsLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const summary = await runDataQualityChecks(userId);

    logger.info({
      operation: "run_data_quality_checks",
      message: "Data-quality checks re-run",
      context: { userId, ...summary },
    });

    res.json(summary);
  } catch (error) {
    next(error);
  }
});

/**
 * Every answer replies with the finding as it now stands (spec C3), in this
 * router's `{success, data}` family. `data` is null only when the record the
 * finding is about no longer exists. A refusal carries the contract's stable
 * code in `error` (`notFound`, `invalidAction`, `undoExpired`, `staleFinding`)
 * and, for `invalidAction`, a `reason`.
 */
async function answer(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  act: (id: string, userId: string) => Promise<void>
): Promise<void> {
  try {
    const userId = req.userId!;
    const { id } = dataQualityFlagIdParamSchema.parse(req.params);
    await act(id, userId);
    res.json({ success: true, data: await getFlagView(id, userId) });
  } catch (error) {
    if (error instanceof FindingActionError) {
      res
        .status(error.status)
        .json({ error: error.code, ...(error.reason ? { reason: error.reason } : {}) });
      return;
    }
    next(error);
  }
}

/**
 * Without a body: "I have corrected the data" — a later run re-opens this if
 * the contradiction is still there (`services/dataQuality/runner.ts`). With
 * `{ action }`: a kind-specific answer the flag lists in `actions` — `keep` or
 * `merge` for a duplicate. See `services/dataQuality/findingActions.ts`.
 *
 * Ownership is in every WHERE: a flag that is not yours is `notFound`,
 * indistinguishable from one that does not exist.
 */
router.post("/:id/resolve", (req: AuthRequest, res: Response, next: NextFunction) =>
  answer(req, res, next, (id, userId) =>
    resolveFinding(id, userId, resolveFindingBodySchema.parse(req.body ?? {}))
  )
);

/**
 * "This is not wrong, stop asking."
 *
 * Never re-opened by a run. A check can be right that two sources disagree and
 * wrong about which one to believe, and a third party's geocoder does not get a
 * veto over the user's own data — this is where the user says so.
 */
router.post("/:id/dismiss", (req: AuthRequest, res: Response, next: NextFunction) =>
  answer(req, res, next, (id, userId) =>
    dismissFinding(id, userId, answerGuardBodySchema.parse(req.body ?? {}))
  )
);

/**
 * Take the last answer back within `undoUntil` (10 minutes) — `dismiss`,
 * `keep`, a plain `resolve`. A `merge` has no server undo (owner, 2026-10-25).
 */
router.post("/:id/undo", (req: AuthRequest, res: Response, next: NextFunction) =>
  answer(req, res, next, (id, userId) =>
    undoFinding(id, userId, answerGuardBodySchema.parse(req.body ?? {}))
  )
);

export default router;
