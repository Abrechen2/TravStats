import { Router, Response, NextFunction } from "express";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { lodgingImportLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import {
  batchIdParamsSchema,
  lodgingImportCommitRequestSchema,
  lodgingImportPreviewRequestSchema,
  suggestMappingRequestSchema,
} from "../schemas/lodgingImport";
import { buildLodgingPreviewRows } from "../services/lodging/lodgingImportPreview";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import {
  listLodgingImportBatches,
  revertLodgingImportBatch,
} from "../services/lodging/lodgingImportBatches";
import { backfillLodgingLocations } from "../services/lodging/geocodeBackfill";
import { suggestLodgingCsvMapping } from "../services/lodging/mappingSuggestion";
import { triggerDataQualityChecks } from "../services/dataQualityTrigger";

// Mounted at /api/v1/lodging-import — deliberately NOT under
// /api/v1/lodging/import: routes/lodging.ts has a `GET /:id` handler that
// would swallow "import" as a lodging id if this were nested under it.
const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST/DELETE — consistent with routes/lodging.ts.
router.use(requireWriteScope);
router.use(lodgingImportLimiter);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

router.post("/preview", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = lodgingImportPreviewRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const result = await buildLodgingPreviewRows(userId, parsed.data.candidates);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/commit", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // `userId` always comes from the authenticated session, never the body —
    // the request schema below has no userId field at all, so there is no
    // client-controlled way to write into another user's account through it.
    const userId = requireUser(req);
    const parsed = lodgingImportCommitRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const result = await commitLodgingImport(
      userId,
      parsed.data.source,
      parsed.data.fileName,
      parsed.data.rows,
    );

    // Fire-and-forget: the rows are already committed and usable. Geocoding is
    // 1 req/s (Nominatim) — awaiting it here would stall the response for
    // minutes on a large import. A row without coordinates is valid; it just
    // has no pin until this pass reaches it. Runs BOTH directions: an imported
    // row may arrive with an address and no pin, or (a Google-Maps export) with
    // a pin and no address. `backfillLodgingLocations`
    // never throws (it swallows and logs internally), but this `.catch` is a
    // second, independent backstop — an unhandled rejection on a
    // fire-and-forget promise crashes the whole Node process, so this path
    // must never rely on the callee's own discipline alone.
    void backfillLodgingLocations(userId, result.batchId)
      .catch((error: unknown) => {
        logger.error({
          operation: "lodging_geocode_backfill_unhandled",
          batchId: result.batchId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      /**
       * The data-quality checks run AFTER the backfill, not beside it, and the
       * ordering is the whole reason this is a chain rather than a second
       * `void`.
       *
       * `addressCountryMismatch` abstains where either the address or the
       * claimed country is missing — so a row imported with a pin and no
       * address has nothing to disagree with at commit time. The backfill is
       * what gives it one. Worse, it can CREATE the contradiction: a row with
       * an address and no country gets its country from a geocoder, and a
       * geocoder putting a Slovenian hotel in Bucharest is precisely the case
       * this feature exists for (design §1.4).
       *
       * `.then` after `.catch` runs in both outcomes — a backfill that failed
       * still leaves rows worth checking. Neither link rejects, so the `void`
       * above cannot become an unhandled rejection.
       */
      .then(() =>
        triggerDataQualityChecks(userId, {
          trigger: "lodging_import",
          batchId: result.batchId,
        }),
      );

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get("/batches", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    res.json({ success: true, data: await listLodgingImportBatches(userId) });
  } catch (err) {
    next(err);
  }
});

router.delete("/batches/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    // Validate BEFORE any DB work — `revertLodgingImportBatch` opens a
    // Serializable transaction just to look the id up, so a malformed id
    // must 400 here rather than pay for a transaction that can only ever
    // 404.
    const parsedParams = batchIdParamsSchema.safeParse(req.params);
    if (!parsedParams.success) throw new AppError(parsedParams.error.message, 400);

    const result = await revertLodgingImportBatch(userId, parsedParams.data.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/suggest-mapping", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireUser(req);
    const parsed = suggestMappingRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    // Never throws — `{}` means "use your heuristic".
    const mapping = await suggestLodgingCsvMapping(parsed.data.headers, parsed.data.sampleRows);
    res.json({ success: true, data: { mapping } });
  } catch (err) {
    next(err);
  }
});

export default router;
