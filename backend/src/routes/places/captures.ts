import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import {
  captureQuerySchema,
  createCaptureSchema,
  resolveCaptureSchema,
} from "../../schemas/placeCapture";
import {
  createCapture,
  dismissCapture,
  listCaptures,
  resolveCapture,
  toCaptureDto,
} from "../../services/places/placeCaptures";
import { recheckAchievements } from "../../utils/achievements";

/**
 * `/places/captures` — positions the Companion recorded before they had a name
 * (companion#90). Own file on the places prefix, mounted BEFORE `places.ts`:
 * its `GET /:id` would otherwise swallow "captures" as a place id.
 *
 * No rate limiter, for the reason `places.ts` gives: per-user CRUD, every
 * handler scoped by `userId`, the list bounded (`CAPTURE_LIST_LIMIT`).
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

router.post("/captures", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createCaptureSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400, "VALIDATION_FAILED");
    const { row, created } = await createCapture(userId, parsed.data);
    res.status(created ? 201 : 200).json({ success: true, data: toCaptureDto(row) });
  } catch (error) {
    next(error);
  }
});

router.get("/captures", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = captureQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400, "VALIDATION_FAILED");
    const rows = await listCaptures(userId, parsed.data.status);
    res.json({ success: true, data: rows.map(toCaptureDto) });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/captures/:id/resolve",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const parsed = resolveCaptureSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400, "VALIDATION_FAILED");
      const row = await resolveCapture(userId, req.params.id, parsed.data, req);
      await recheckAchievements(userId, "capture resolve");
      res.json({ success: true, data: toCaptureDto(row) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/captures/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const row = await dismissCapture(userId, req.params.id);
    res.json({ success: true, data: toCaptureDto(row) });
  } catch (error) {
    next(error);
  }
});

export default router;
