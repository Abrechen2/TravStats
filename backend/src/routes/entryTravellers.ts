import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { travellerFactsBodySchema, travellersQuerySchema } from "../schemas/entryTravellers";
import { listTravellers, setTravellerFacts } from "../services/companions/travellerFacts";

/**
 * Per-traveller facts on an entry — plan D7
 * (docs/superpowers/specs/2026-11-21-document-links.md). Enveloped family.
 * Everything is the caller's own: a companion or entry of another account is a 404.
 */
const router = Router();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError(parsed.error.issues.map((i) => i.message).join("; "), 400);
  return parsed.data;
}

router.get(
  "/entry-travellers",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const q = parseOrThrow(travellersQuerySchema, req.query);
      res.json({
        success: true,
        data: await listTravellers(req.userId!, { type: q.entryType, id: q.entryId }),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/entry-travellers/:companionId",
  authenticate,
  rejectDemo,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const companionId = parseOrThrow(z.string().uuid(), req.params.companionId);
      const body = parseOrThrow(travellerFactsBodySchema, req.body);
      res.json({
        success: true,
        data: await setTravellerFacts(req.userId!, body.entry, companionId, body.facts),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
