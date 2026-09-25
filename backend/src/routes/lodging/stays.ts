/**
 * Stays — the episodes of a lodging.
 *
 * Split out of `routes/lodging.ts` on 2026-09-15 to bring it back under the
 * 800-line limit, and the seam holds on its own: a lodging is a PLACE, a stay
 * is a visit to it. The two have different lifetimes, different validation and
 * different money (a stay carries the price, the lodging does not).
 *
 * Paths are unchanged and nested under `/:id`, mounted from the lodging router
 * so Express matches in exactly the order it did before.
 */

import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { linkDocuments, takeDocumentIds } from "../../services/documents/documentService";
import { recheckAchievements } from "../../utils/achievements";
import { createStaySchema, updateStaySchema } from "../../schemas/lodging";
import logger from "../../utils/logger";
import { requireUser } from "../../middleware/auth";
import { createStayRecord, updateStayRecord } from "../../services/lodging/stayWrites";

const router = Router();

// ---- Stay CRUD (nested under a lodging) ----

router.post("/:id/stays", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const parsed = createStaySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const documentIds = await takeDocumentIds(userId, req.body);
    // The whole write — references, price, FX, derived status/rating — lives
    // in `services/lodging/stayWrites.ts`, shared with the spreadsheet import.
    const stay = await createStayRecord(userId, lodging.id, parsed.data);

    await linkDocuments(userId, documentIds, { type: "lodgingStay", id: stay.id });
    await recheckAchievements(userId, "lodging");
    logger.info({
      operation: "lodging_stay_create",
      stayId: stay.id,
      lodgingId: lodging.id,
      userId,
    });
    res.status(201).json({ success: true, data: stay });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/stays/:stayId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: lodging.id, userId },
    });
    if (!stay) throw new AppError("Stay not found", 404);

    const parsed = updateStaySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    // Shared with the spreadsheet import — see `services/lodging/stayWrites.ts`.
    const updated = await updateStayRecord(userId, stay, parsed.data);

    await recheckAchievements(userId, "lodging");
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/stays/:stayId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: lodging.id, userId },
    });
    if (!stay) throw new AppError("Stay not found", 404);

    await prisma.lodgingStay.delete({ where: { id: stay.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
