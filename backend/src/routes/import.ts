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
 * - Both routes are rate-limited (`lodgingImportLimiter`, the shared bulk-import
 *   bucket). The row and byte ceilings bound ONE request; without a limiter
 *   nothing bounds a thousand of them, and each is a 2 MiB lex or a
 *   thousand-row enrichment. The limiter goes AFTER `authenticate` on each
 *   route so it keys per user rather than per IP.
 */

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { lodgingImportLimiter } from "../middleware/rateLimit";
import { buildPreviewRows, MAX_PREVIEW_ROWS } from "../services/importPreview";
import { parseFr24 } from "../services/parsers/fr24";
import { parseGenericCsv } from "../services/parsers/genericCsv";
import logger from "../utils/logger";

const router = Router();

const MAX_CSV_BYTES = 2_000_000; // 2 MiB — same defensive ceiling as MAX_PREVIEW_ROWS

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
  lodgingImportLimiter,
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

// ---------------------------------------------------------------------------
// POST /api/v1/import/parse
//
// Parses a raw CSV blob into the same `PreviewRowInput[]` shape that the
// browser-side import flow produces, so external API-token consumers can
// call /import/preview + /flights/batch without re-implementing the FR24
// or generic-CSV lexer in their own scripts. Pure function — no DB writes,
// no auth scope check beyond `authenticate` (any PAT scope incl. read).
//
// Body: { source: "fr24", csv: string }
//   or: { source: "generic_csv", csv: string, mapping: GenericMapping }
// Returns: { success: true, rows, parserErrors }
// ---------------------------------------------------------------------------

const genericMappingSchema = z
  .object({
    date: z.string().optional(),
    depTimeLocal: z.string().optional(),
    arrTimeLocal: z.string().optional(),
    fromIata: z.string().optional(),
    toIata: z.string().optional(),
    flightNumber: z.string().optional(),
    airline: z.string().optional(),
    aircraft: z.string().optional(),
    registration: z.string().optional(),
    seatNumber: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

const parseRequestSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("fr24"),
    csv: z.string().min(1).max(MAX_CSV_BYTES),
  }),
  z.object({
    source: z.literal("generic_csv"),
    csv: z.string().min(1).max(MAX_CSV_BYTES),
    mapping: genericMappingSchema,
  }),
]);

router.post(
  "/parse",
  authenticate,
  lodgingImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const parsed = parseRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const result =
        parsed.data.source === "fr24"
          ? parseFr24(parsed.data.csv)
          : parseGenericCsv(parsed.data.csv, parsed.data.mapping);

      if (result.rows.length > MAX_PREVIEW_ROWS) {
        return res.status(413).json({
          success: false,
          error: `Too many rows: ${result.rows.length} exceeds the limit of ${MAX_PREVIEW_ROWS}`,
        });
      }

      return res.status(200).json({
        success: true,
        rows: result.rows,
        parserErrors: result.parserErrors,
      });
    } catch (err) {
      logger.error({
        operation: "import_parse_route_error",
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  }
);

export default router;
