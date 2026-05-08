/**
 * Import preview route.
 *
 * POST /api/v1/import/preview
 *
 * Accepts a parsed array of PreviewRowInput objects from the frontend
 * (produced by the FR24 or Generic-CSV parser), enriches each row with
 * UTC times, airport coordinates, timezone info, per-row flags, and a
 * dedupe hint, then returns the enriched rows alongside a summary
 * object.  The endpoint is read-only — no data is persisted here.
 *
 * Security posture:
 * - `authenticate` middleware is required; unauthenticated callers get 401.
 * - `userId` is taken exclusively from `req.userId` (the verified JWT
 *   session).  Any `userId` field in the request body is silently
 *   ignored to prevent IDOR attacks.
 * - Payloads exceeding MAX_PREVIEW_ROWS (1000) rows are rejected with 413.
 */

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { buildPreviewRows, MAX_PREVIEW_ROWS } from "../services/importPreview";
import logger from "../utils/logger";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schema for the incoming preview request body
// ---------------------------------------------------------------------------

const previewRowInputSchema = z.object({
  date: z.string(),
  depTimeLocal: z.string().optional(),
  arrTimeLocal: z.string().optional(),
  durationSeconds: z.number().optional(),
  fromIata: z.string(),
  toIata: z.string(),
  flightNumber: z.string().optional(),
  airline: z.string().optional(),
  aircraft: z.string().optional(),
  registration: z.string().optional(),
  seatNumber: z.string().optional(),
  seatClass: z
    .enum(["economy", "premium_economy", "business", "first"])
    .optional(),
  category: z
    .enum(["business", "vacation", "private", "training", "ferry", "other"])
    .optional(),
  notes: z.string().optional(),
  source: z.enum(["fr24", "generic_csv"]),
  sourceRowIndex: z.number().int().nonnegative(),
});

const previewRequestSchema = z.object({
  rows: z.array(previewRowInputSchema).min(1).max(MAX_PREVIEW_ROWS + 1),
});

// ---------------------------------------------------------------------------
// POST /api/v1/import/preview
// ---------------------------------------------------------------------------

router.post(
  "/preview",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) {
        // authenticate already rejects unauthenticated requests, but be
        // defensive in case something slips through.
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const parsed = previewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const { rows } = parsed.data;

      if (rows.length > MAX_PREVIEW_ROWS) {
        return res.status(413).json({
          success: false,
          error: `Too many rows: ${rows.length} exceeds the limit of ${MAX_PREVIEW_ROWS}`,
        });
      }

      const result = await buildPreviewRows(userId, rows);

      return res.status(200).json({
        success: true,
        rows: result.rows,
        summary: result.summary,
      });
    } catch (err) {
      logger.error({
        operation: "import_preview_route_error",
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  }
);

export default router;
