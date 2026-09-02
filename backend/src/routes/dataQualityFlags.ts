import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { statsLimiter } from "../middleware/rateLimit";
import {
  dataQualityFlagIdParamSchema,
  listDataQualityFlagsQuerySchema,
} from "../schemas/dataQualityFlag";
import { dismissFlag, listFlags, resolveFlag, runDataQualityChecks } from "../services/dataQuality";
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
 * "I have corrected the data."
 *
 * A later run re-opens this if the contradiction is still there — see
 * `services/dataQuality/runner.ts`.
 */
router.post("/:id/resolve", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = dataQualityFlagIdParamSchema.parse(req.params);

    // updateMany with userId in the WHERE is the ownership check: a flag that
    // is not yours matches nothing and is indistinguishable from one that does
    // not exist, which is what it should be.
    if (!(await resolveFlag(id, userId))) {
      throw new AppError("Data quality flag not found", 404);
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * "This is not wrong, stop asking."
 *
 * Never re-opened. A check can be right that two sources disagree and wrong
 * about which one to believe, and a third party's geocoder does not get a veto
 * over the user's own data — this is where the user says so.
 */
router.post("/:id/dismiss", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = dataQualityFlagIdParamSchema.parse(req.params);

    if (!(await dismissFlag(id, userId))) {
      throw new AppError("Data quality flag not found", 404);
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
