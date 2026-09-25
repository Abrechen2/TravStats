import { Router, Response, NextFunction } from "express";
import { z } from "../../schemas/zod";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { railCreationLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import {
  convertRoadtripToRail,
  previewRoadtripConversion,
} from "../../services/rail/roadtripConversionWrite";
import logger from "../../utils/logger";

/**
 * "Als Bahnfahrt übernehmen" — a roadtrip section by rail, converted into rail
 * journeys (owner decision 1 of the rail spec). Mounted at
 * /api/v1/rail/roadtrip-conversion, ahead of the rail router, whose `/:id`
 * would otherwise take the segment for a journey id. Enveloped, as the rest
 * of the rail family.
 *
 * GET shows what a conversion would write; POST writes it. The section is
 * removed only when the body says `removeSection: true` — the user's
 * confirmation in the dialog — and only when every leg became a ride.
 */
const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so a read-only token can still preview.
router.use(requireWriteScope);

export const roadtripConversionBodySchema = z
  .object({
    /** The user confirmed that the roadtrip goes once its rides exist. */
    removeSection: z.boolean().default(false),
  })
  .strict();

const routeIdSchema = z.string().uuid();

function routeIdOf(req: AuthRequest): string {
  const parsed = routeIdSchema.safeParse(req.params.routeId);
  // Not a uuid is not one of the caller's roadtrips either.
  if (!parsed.success) throw new AppError("Roadtrip not found", 404);
  return parsed.data;
}

router.get("/:routeId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await previewRoadtripConversion(req.userId!, routeIdOf(req));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:routeId",
  railCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const routeId = routeIdOf(req);
      const parsed = roadtripConversionBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const data = await convertRoadtripToRail(req.userId!, routeId, parsed.data);
      logger.info({
        operation: "rail_roadtrip_conversion",
        userId: req.userId,
        routeId,
        created: data.created,
        sectionRemoved: data.sectionRemoved,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
