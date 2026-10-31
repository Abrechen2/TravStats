import { Router, Response, NextFunction } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import { meExportLimiter } from "../middleware/meExportLimiter";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { buildAccountExport } from "../services/export/allDataExport";
import { pipeJsonToResponse } from "../services/export/jsonStream";
import logger from "../utils/logger";

const router = Router();

/**
 * GET /api/v1/me/export (forgejo#391)
 *
 * The signed-in account's own records as a JSON download — the same
 * `buildAccountExport` the WebDAV sync uploads, so a table added to the export
 * reaches this download with it. The user id comes from the session or PAT,
 * never from the request, so there is no way to name another account. Password
 * hash, two-factor and passkey material, API tokens and stored provider keys
 * are not in `USER_EXPORT_SELECT`; a test holds that.
 *
 * Streamed like the admin export: a long history in one string hits V8's limit.
 */
router.get(
  "/export",
  authenticate,
  meExportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { instanceName } = await getInstanceSettings();
      const data = await buildAccountExport(req.userId!, instanceName);
      if (!data) {
        res.status(404).json({ error: "Account not found", code: "account_not_found" });
        return;
      }
      const day = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(`travstats-my-data-${day}.json`)}`
      );
      await pipeJsonToResponse(data, res);
    } catch (error) {
      if (res.headersSent) {
        logger.error({ operation: "me_export_stream_failed", error: String(error) });
        return;
      }
      next(error);
    }
  }
);

export default router;
