/**
 * POST /api/v1/checkin-import — rides from a Träwelling or travelynx export
 * (forgejo#401).
 *
 * The file's text arrives as a string (the client reads the file); the server
 * parses it, matches stations through the catalogue and runs the existing
 * rail / bus import in add mode. `dryRun` is the default: post once to
 * preview, again with `dryRun: false` to apply. The request is untrusted, the
 * rows go through the same write rules as a spreadsheet import.
 */

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { xlsxImportLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import { startJob } from "../services/jobs/jobRegistry";
import { runCheckinImport } from "../services/checkinImport";
import { TooManyRecordsError } from "../services/checkinImport/types";

const router = Router();

const MAX_FILE_CHARS = 8_000_000;

const requestSchema = z.object({
  source: z.enum(["travelling", "travelynx"]),
  /** Omitted: told apart by the first character (`[`/`{` is JSON). */
  format: z.enum(["csv", "json"]).optional(),
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
      const { source, format, content, dryRun, background } = parsed.data;
      const run = async () => {
        const outcome = await runCheckinImport(userId, {
          source,
          text: content,
          format,
          dryRun,
        }).catch((err) => {
          if (err instanceof TooManyRecordsError) {
            throw new AppError("Too many records in one file", 400, "IMPORT_TOO_MANY_ROWS");
          }
          throw err;
        });
        logger.info(
          {
            operation: "checkin_import",
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
          dryRun ? "Check-in import previewed" : "Check-in import applied"
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
