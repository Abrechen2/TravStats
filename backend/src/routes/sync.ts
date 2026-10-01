import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { syncChangesQuerySchema } from "../schemas/sync";
import { readDeltaPage, readFullPage, ResyncRequiredError } from "../services/sync/changeFeed";
import { decodeCursor } from "../services/sync/cursor";
import { loadSyncScope } from "../services/sync/scope";

/**
 * The incremental change feed for the Companion (forgejo#141). Enveloped, as
 * a new router serving several domains (ADR 0001).
 *
 * GET /sync/changes            → a full read of the account, page by page
 * GET /sync/changes?since=…    → what changed after that cursor
 *
 * Every answer carries the cursor for the next call and `hasMore`. A cursor
 * the server can no longer continue is answered 410 `SYNC_RESYNC_REQUIRED`
 * with a reason — never with a partial feed. See `services/sync/cursor.ts`.
 */
const router = Router();

// `authenticate` per route, never `router.use`: this router is mounted at
// /api/v1, so a router-level guard would answer 401 for every PUBLIC endpoint
// mounted after it (pairing claim, airport search, login backgrounds) — the
// regression `tourRoutes.crud.test.ts` describes for its own router.
router.get(
  "/sync/changes",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError("Not authenticated", 401);
      const query = syncChangesQuerySchema.parse(req.query);
      const scope = await loadSyncScope(userId);

      if (query.since === undefined) {
        res.json({ success: true, data: await readFullPage(userId, null, scope, query.limit) });
        return;
      }
      const cursor = decodeCursor(query.since);
      if (!cursor) {
        throw new AppError("since is not a cursor this server issued", 400, "VALIDATION_FAILED");
      }
      const page =
        cursor.mode === "full"
          ? await readFullPage(userId, cursor, scope, query.limit)
          : await readDeltaPage(userId, cursor, scope, query.limit);
      res.json({ success: true, data: page });
    } catch (error) {
      if (error instanceof ResyncRequiredError) {
        res.status(410).json({
          success: false,
          error: "The sync cursor can no longer be continued; start a full sync.",
          code: "SYNC_RESYNC_REQUIRED",
          reason: error.reason,
        });
        return;
      }
      next(error);
    }
  }
);

export default router;
