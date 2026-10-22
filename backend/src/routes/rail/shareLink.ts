import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { railLookupLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { railBahnHandoffSchema, railShareLinkSchema } from "../../schemas/railShareLink";
import { resolveBahnHandoff, resolveShareLink } from "../../services/rail/shareLink";

/**
 * A rail journey from a pasted link (forgejo#204). Nothing is stored: a read
 * connection goes to the ordinary rail review, where each leg is confirmed and
 * saved through POST /rail. A failure answers 200 with its reason and the
 * facts the link carried — it is a result the import dialog shows beside its
 * other ways in (a PDF, a booking mail, typing it), not an error.
 *
 * One request to bahn.de per call, so it shares the train lookup's tight
 * bucket. Mounted ahead of the rail router, whose `/:id` would take
 * "share-link" for a journey id.
 */
const router = Router();
router.use(authenticate);

router.post("/", railLookupLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = railShareLinkSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const data = await resolveShareLink(parsed.data.url, req.userId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * The connection the "In TravStats übernehmen" bookmarklet read on bahn.de
 * itself, where the user is an ordinary visitor (forgejo#204). No request to
 * bahn.de is made here: the answer is read by the same reader as a server
 * fetch and goes to the same review. Same bucket as the link route — one
 * click, one call.
 */
router.post(
  "/connection",
  railLookupLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = railBahnHandoffSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const data = await resolveBahnHandoff(parsed.data.answer, req.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
