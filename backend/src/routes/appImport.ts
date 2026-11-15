/**
 * POST /api/v1/app-import — another travel app's export (TripIt, Polarsteps,
 * JetLovers, FlightMemory, Logmyflight) through the spreadsheet importer's
 * preview/commit rules (forgejo#401).
 *
 * The file's text arrives as a string inside the JSON body (the client reads
 * the file), so there is no multipart upload and no content-type to set. The
 * server parses it; `dryRun` is the default: post once to preview, again with
 * `dryRun: false` to apply. Rows go through the same write rules, and the same
 * natural-key dedupe against stored entries, as a spreadsheet import.
 */

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { xlsxImportLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import { startJob } from "../services/jobs/jobRegistry";
import { runAppImport } from "../services/appImport";
import { APP_SOURCES } from "../services/appImport/types";
import { TooManyRecordsError } from "../services/checkinImport/types";

const router = Router();

const MAX_FILE_CHARS = 8_000_000;

const requestSchema = z.object({
  source: z.enum(APP_SOURCES as [string, ...string[]]),
  content: z.string().min(1).max(MAX_FILE_CHARS),
  dryRun: z.boolean().default(true),
  background: z.boolean().default(false),
});

router.post(
  "/",
  authenticate,
  requireWriteScope,
  rejectDemoWrites,
  xlsxImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError("Unauthorized", 401);
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const { content, dryRun, background } = parsed.data;
      const source = parsed.data.source as (typeof APP_SOURCES)[number];
      const run = async () => {
        const outcome = await runAppImport(userId, { source, text: content, dryRun }).catch(
          (err) => {
            if (err instanceof TooManyRecordsError) {
              throw new AppError("Too many records in one file", 400, "IMPORT_TOO_MANY_ROWS");
            }
            throw err;
          }
        );
        logger.info(
          {
            operation: "app_import",
            userId,
            source,
            dryRun,
            sheets: outcome.sheets.map((s) => ({
              key: s.key,
              created: s.created,
              skipped: s.skipped,
              errors: s.errors,
            })),
          },
          dryRun ? "App import previewed" : "App import applied"
        );
        return outcome;
      };
      if (background) {
        const job = startJob("xlsx.import", userId, run);
        res.status(202).json({ success: true, data: { jobId: job.id } });
        return;
      }
      res.json({ success: true, data: await run() });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
