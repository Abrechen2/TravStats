import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { statsLimiter } from "../middleware/rateLimit";
import {
  evidenceParamsSchema,
  evidenceQuerySchema,
  evidenceResponseSchema,
  evidenceScopeFromQuery,
} from "../schemas/evidence";
import { resolveEvidence } from "../services/evidence";

/**
 * `GET /evidence/:kind/:key` — "which entries produced this number".
 *
 * Plumbing: schema, dispatch, paging inputs. Which measures actually answer is
 * decided by `DEFAULT_RESOLVERS` in `services/evidence/index.ts`, not here — a
 * key with no resolver registered answers 404, which is why this file states no
 * list of its own. It said "no resolver is wired here" until the airline
 * ranking landed, and a comment that names today's contents of another module
 * is a comment that will be wrong by the next commit. This
 * route never writes — the four answers below are read-only by construction,
 * and none of them may become `checkAndUpdateAchievements` or anything else
 * that persists (`docs/superpowers/specs/2026-09-18-evidence-panel-design.md`,
 * "Release 1 — rankings and metrics", the performance paragraph).
 *
 * The four answers, none of them collapsed into the others:
 *   - kind valid, key not served by this instance → 404 (never an empty 200 —
 *     that would hide a frontend bug).
 *   - kind valid, key valid, user has nothing → 200, `value: 0`.
 *   - kind valid, key valid, measure undecidable → 200, `value: null` +
 *     `unattributed` naming why — never 0.
 *   - key belongs to another user → 404, never 403 (a 403 confirms the row
 *     exists).
 *   - `record` / `achievement` → 501, a release fact, not a 404.
 */
const router = Router();
router.use(authenticate);
/**
 * The same bucket as the other expensive stats routes, and for the same reason:
 * one request scans the caller's whole set — every flight, every stay — to
 * attribute one number, and none of that is bounded by the `limit`/`offset` the
 * caller sends, which only pages the answer. The router had no limiter of its
 * own at all, so the only thing in front of it was the global `/api` cap, and
 * that one was skipping every private source address until the same audit
 * closed it (security audit of 2026-09-19, findings 6 and 5 — they compound).
 *
 * Per user, not per IP (`userOrIpKey`), so one visitor of a public preview
 * cannot lock the panel for the next.
 */
router.use(statsLimiter);

router.get("/:kind/:key", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = evidenceParamsSchema.parse(req.params);
    const query = evidenceQuerySchema.parse(req.query);
    const scope = evidenceScopeFromQuery(query);
    const page = { offset: query.offset, limit: query.limit };

    const result = await resolveEvidence(req.userId!, params.kind, params.key, scope, page);

    if (result.status === "unservedKind") {
      throw new AppError(`Evidence for kind '${params.kind}' is not served until release 2`, 501);
    }
    if (result.status === "unknownKey") {
      throw new AppError("Unknown evidence key", 404);
    }

    res.json(evidenceResponseSchema.parse(result.response));
  } catch (err) {
    next(err);
  }
});

export default router;
