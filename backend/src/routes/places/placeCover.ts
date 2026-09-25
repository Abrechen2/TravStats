import { Router, type NextFunction, type Response } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { placeCoverSchema } from "../../schemas/place";

/**
 * `PUT /places/:id/cover` — which photograph the place page leads with
 * (package 9, item 3). Own file on the places prefix, mounted before
 * `places.ts` like its siblings.
 *
 * The photo must hang off a visit to THIS place of THIS user. The foreign key
 * only proves the photo exists; checked through the visit, a cover can never
 * point at a stranger's picture or at one of the user's other places.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

router.put(
  "/:id/cover",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = placeCoverSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const place = await prisma.place.findFirst({
        where: { id: req.params.id, userId },
        select: { id: true },
      });
      if (!place) throw new AppError("Place not found", 404);

      const { photoId } = parsed.data;
      if (photoId !== null) {
        const photo = await prisma.placeVisitPhoto.findFirst({
          where: { id: photoId, visit: { placeId: place.id, userId } },
          select: { id: true },
        });
        if (!photo) throw new AppError("Photo not found", 404);
      }

      const saved = await prisma.place.update({
        where: { id: place.id },
        data: { coverPhotoId: photoId },
        select: { coverPhotoId: true },
      });
      res.json({ success: true, data: saved });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
