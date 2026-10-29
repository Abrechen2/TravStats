import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { travTrackDiagnosticsLimiter } from "../../middleware/travTrackViewLimits";
import {
  DIAGNOSTICS_MAX_BODY_BYTES,
  diagnosticsDayQuerySchema,
  diagnosticsExportQuerySchema,
  diagnosticsUploadSchema,
} from "../../schemas/travtrackDiagnostics";
import { deleteDiagnostics, ingestDiagnostics } from "../../services/travtrack/diagnostics/ingest";
import { diagnosticsDay, diagnosticsExport } from "../../services/travtrack/diagnostics/read";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * The TravTrack diagnostics log (spec 2026-10-29-travtrack-diagnostics): a
 * paired phone sends what its recorder, uploader and lifecycle did, and the
 * owner reads it against the stored points. Bare (ADR 0001), owner only —
 * nothing here is shared, exported with the history or federated.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

/** POST /travtrack/diagnostics — `{ uploadId, device?, events }`, idempotent per device. */
router.post(
  "/travtrack/diagnostics",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  travTrackDiagnosticsLimiter,
  route(async (req, res) => {
    if (
      Number(req.get("content-length") ?? 0) > DIAGNOSTICS_MAX_BODY_BYTES ||
      Buffer.byteLength(JSON.stringify(req.body ?? null)) > DIAGNOSTICS_MAX_BODY_BYTES
    ) {
      throw new AppError("The upload is too large", 413, "TRACK_BODY_TOO_LARGE");
    }
    const deviceId = req.apiToken?.deviceId;
    if (!deviceId) {
      throw new AppError(
        "Diagnostics are sent by a paired device",
        403,
        "TRAVTRACK_DEVICE_REQUIRED"
      );
    }
    const body = diagnosticsUploadSchema.parse(req.body);
    const { result, replayed } = await ingestDiagnostics({
      userId: req.userId!,
      deviceId,
      uploadId: body.uploadId,
      device: body.device ?? {},
      events: body.events,
    });
    if (!replayed) {
      logger.info({
        operation: "travtrack.diagnostics.ingest",
        uploadId: result.uploadId,
        stored: result.stored,
        rejected: result.rejected.length,
      });
    }
    res.status(replayed ? 200 : 201).json({ ...result, replayed });
  })
);

/** GET /travtrack/diagnostics/day?date&deviceId — one device's day with its gaps explained. */
router.get(
  "/travtrack/diagnostics/day",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    const { date, deviceId } = diagnosticsDayQuerySchema.parse(req.query);
    res.json(await diagnosticsDay(req.userId!, date, deviceId));
  })
);

/** GET /travtrack/diagnostics/export?from&to&deviceId — the raw log as a file. */
router.get(
  "/travtrack/diagnostics/export",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    const q = diagnosticsExportQuerySchema.parse(req.query);
    const body = await diagnosticsExport(req.userId!, q.from, q.to, q.deviceId);
    const stamp = q.from.slice(0, 10);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="travtrack-diagnostics-${stamp}.json"`
    );
    res.json(body);
  })
);

/** DELETE /travtrack/diagnostics — every diagnostics row of the account. */
router.delete(
  "/travtrack/diagnostics",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    res.json({ deleted: await deleteDiagnostics(req.userId!) });
  })
);

export default router;
