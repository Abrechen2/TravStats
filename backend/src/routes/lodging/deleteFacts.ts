import { Router, type NextFunction, type Response } from "express";

import { prisma } from "../../db";
import { type AuthRequest, requireUser } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

/**
 * `GET /lodging/:id/delete-facts` - what deleting this house would take with it
 * besides its stays, in ONE request (forgejo#250): how many photographs it has
 * and how many kept originals (`Document`) hang off ALL of its stays.
 *
 * The confirmation dialog used to ask the documents API once per stay, so a
 * house with forty stays cost forty-one requests to draw a question. Both
 * counts cascade on delete (`LodgingPhoto` from `lodging`, `Document` from
 * `lodgingStay`), which is why they are worth stating at all.
 */
const router = Router();

router.get("/:id/delete-facts", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true },
    });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const [photoCount, documentCount] = await Promise.all([
      prisma.lodgingPhoto.count({ where: { lodgingId: lodging.id } }),
      prisma.document.count({ where: { userId, lodgingStay: { lodgingId: lodging.id } } }),
    ]);
    res.json({ success: true, data: { photoCount, documentCount } });
  } catch (err) {
    next(err);
  }
});

export default router;
