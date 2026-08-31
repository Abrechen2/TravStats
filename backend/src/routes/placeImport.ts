import { Router, Response, NextFunction } from "express";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { lodgingImportLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { placeImportCommitSchema, placeImportPreviewSchema } from "../schemas/placeImport";
import { previewPlaceImport } from "../services/places/placeImportPreview";
import { commitPlaceImport } from "../services/places/placeImportCommit";

/**
 * Mounted at /api/v1/place-import — deliberately NOT under /api/v1/places/import.
 * `routes/places.ts` has a `GET /:id`, which would swallow "import" as a place
 * id, and `lodgingImport.ts` carries the same note for the same reason.
 *
 * Two steps, never one: preview says what WOULD happen, commit does it. That
 * separation is the point of POI Phase D §5 — a row the machine cannot place is
 * offered back to the user rather than dropped, and there is nowhere to offer it
 * if the import is a single fire-and-forget call.
 */
const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so a read-only token keeps read access and
// cannot import. Consistent with routes/lodgingImport.ts.
router.use(requireWriteScope);
// Shares the lodging import's limiter rather than adding a second one: it is
// the same shape of expensive request, and one bucket is one thing to reason
// about when someone is being abusive.
router.use(lodgingImportLimiter);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

router.post("/preview", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = placeImportPreviewSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const preview = await previewPlaceImport(userId, parsed.data.candidates);
    res.json({ success: true, data: preview });
  } catch (error) {
    next(error);
  }
});

router.post("/commit", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = placeImportCommitSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const result = await commitPlaceImport(
      userId,
      parsed.data.source,
      parsed.data.fileName ?? null,
      parsed.data.rows
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
