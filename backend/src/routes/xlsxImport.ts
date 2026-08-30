/**
 * POST /api/v1/xlsx-import — apply an edited export workbook.
 *
 * The client parses the .xlsx (exceljs already runs there for the export) and
 * posts the sheets as rows of strings. Parsing in the browser keeps a
 * spreadsheet parser off the server's attack surface, and the server still
 * validates every field through the domain schemas — the request is treated as
 * untrusted whichever way it was produced.
 *
 * `dryRun` is the default. An import that rewrites hundreds of rows must be
 * previewable, so the flow is: post with `dryRun: true`, show the user what
 * would happen, and only post again with `dryRun: false` when they agree.
 */

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import { createBackup } from "../services/backupService";
import { importSheets, MAX_ROWS_PER_SHEET } from "../services/xlsxImport/importSheets";
import type { ImportOutcome } from "../services/xlsxImport/types";

const router = Router();

/** Cells are strings by the time they leave the spreadsheet reader. The bound
 *  on sheets and rows is what stops one request from pinning the process. */
const requestSchema = z.object({
  dryRun: z.boolean().default(true),
  /** Defaults to the non-destructive one. A caller that omits this can never
   *  accidentally get `replace`. */
  mode: z.enum(["add", "merge", "replace"]).default("merge"),
  sheets: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        rows: z.array(z.record(z.string(), z.string())).max(MAX_ROWS_PER_SHEET),
      }),
    )
    .min(1)
    .max(16),
});

router.post(
  "/",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError("Unauthorized", 401);

      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const { dryRun, mode, sheets } = parsed.data;

      // A destructive import takes a full backup FIRST, so "undo this" has an
      // answer that is not an apology. Deliberately before the write and
      // outside the dry run: a preview must stay free of side effects, and a
      // backup taken after the delete would be a backup of the damage.
      //
      // If the backup itself fails, the import does NOT proceed. Losing rows
      // is recoverable with a backup and not without one — that asymmetry is
      // what decides this.
      let backupId: string | null = null;
      if (mode === "replace" && !dryRun) {
        try {
          backupId = await createBackup();
          logger.info(
            { operation: "xlsx_import_pre_backup", userId, backupId },
            "Backup taken before destructive spreadsheet import",
          );
        } catch (err) {
          logger.error(
            { operation: "xlsx_import_pre_backup_failed", userId, err },
            "Refusing a replace import because the safety backup failed",
          );
          throw new AppError("backup_failed", 503);
        }
      }

      const results = await importSheets(sheets, { userId, dryRun, mode });
      const clean = results.every((s) => s.errors === 0);

      const outcome: ImportOutcome = { dryRun, mode, sheets: results, clean, backupId };

      logger.info(
        {
          operation: "xlsx_import",
          userId,
          dryRun,
          mode,
          backupId,
          sheets: results.map((s) => ({
            key: s.key,
            created: s.created,
            updated: s.updated,
            deleted: s.deleted,
            errors: s.errors,
          })),
        },
        dryRun ? "Spreadsheet import previewed" : "Spreadsheet import applied",
      );

      res.json({ success: true, data: outcome });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
