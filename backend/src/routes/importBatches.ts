import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { lodgingImportLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import {
  IMPORT_DOMAINS,
  IMPORT_SOURCES,
  createImportBatch,
  listImportBatches,
  revertImportBatch,
} from "../services/importBatchService";

/**
 * One log for every import, whatever area it landed in — and one way to take
 * it back. Stays already had this; flights and cruises left no trace at all,
 * which is why "undo" only ever appeared for one area out of three.
 */
const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so a read-only token keeps read access but
// cannot create or revert — same rule as the other import routes.
router.use(requireWriteScope);
router.use(lodgingImportLimiter);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const createSchema = z.object({
  domain: z.enum(IMPORT_DOMAINS),
  source: z.enum(IMPORT_SOURCES),
  // The file name is shown back to the user in the log, so it is bounded and
  // never interpreted as a path — it is a label, not a location.
  fileName: z.string().trim().max(255).nullable().optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    res.json({ success: true, data: await listImportBatches(userId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const batch = await createImportBatch(
      userId,
      parsed.data.domain,
      parsed.data.source,
      parsed.data.fileName ?? null,
    );
    res.status(201).json({ success: true, data: batch });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = idParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new AppError("Invalid batch id", 400);
    const result = await revertImportBatch(userId, parsed.data.id);
    logger.info({
      operation: "import_batch_reverted",
      userId,
      domain: result.domain,
      deleted: result.deleted,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
