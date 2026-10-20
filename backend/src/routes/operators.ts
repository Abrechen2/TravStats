import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { airlineLogoLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  OPERATOR_DOMAINS,
  answerOperatorMark,
  type OperatorMarkAnswer,
} from "../services/operatorLogos/operatorMarkService";
import { isKnownOperatorName } from "../services/operatorLogos/operatorOwnership";

/**
 * Operator marks for the map cards (forgejo#323): the logo of a rail
 * operator, coach company, ferry line, cruise line or rental company, by the
 * name a journey records — from the vendored catalogues, else from Wikidata /
 * Commons (`operatorMarkService.ts`). Fetched here, never by the browser.
 *
 * Two endpoints, because an <img> cannot read a credit: `/mark` says whether
 * there is a logo and whom to credit for it; `/logo` serves the bytes.
 * Enveloped like the rail and rental catalogues (ADR 0001).
 */
const router = Router();
router.use(authenticate);

const querySchema = z.object({
  domain: z.enum(OPERATOR_DOMAINS),
  name: z.string().trim().min(1).max(120),
});

function parse(query: unknown): z.infer<typeof querySchema> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) throw new AppError("A domain and an operator name are required", 400);
  return parsed.data;
}

/**
 * Only a name the catalogues or the user's OWN journeys record is looked up
 * (review of forgejo#323) — an arbitrary string costs no Wikimedia request.
 * The lookup counts against the user's cold-lookup window and waits only so
 * long; past that the answer is `pending` and the monogram stands for now.
 */
async function answerFor(req: AuthRequest): Promise<OperatorMarkAnswer> {
  const { domain, name } = parse(req.query);
  const userId = req.userId;
  if (!userId || !(await isKnownOperatorName(userId, domain, name))) {
    return { mark: null, pending: false };
  }
  return answerOperatorMark(domain, name, { userId });
}

/** GET /operators/mark?domain=ferry&name=Stena%20Line — whether a logo exists, and its credit. */
router.get(
  "/mark",
  airlineLogoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mark, pending } = await answerFor(req);
      // `private`: an /api answer is never for a shared cache (CLAUDE.md). A
      // pending answer is not cached at all — the next view should ask again.
      res.setHeader("Cache-Control", pending ? "private, no-store" : "private, max-age=3600").json({
        success: true,
        data: mark
          ? { available: true, pending: false, source: mark.source, credit: mark.credit }
          : { available: false, pending, source: null, credit: null },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /operators/logo?domain=ferry&name=Stena%20Line — the logo bytes, always a
 * raster image (Commons renders an SVG logo to PNG), or 404 when there is none.
 * The client draws the monogram for a 404; nothing here answers with a stand-in.
 */
router.get(
  "/logo",
  airlineLogoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mark, pending } = await answerFor(req);
      if (!mark) {
        res
          .status(404)
          .setHeader("Cache-Control", pending ? "private, no-store" : "private, max-age=3600")
          .json({ success: false, error: "No logo available" });
        return;
      }
      res
        .setHeader("Content-Type", mark.image.contentType)
        .setHeader("Cache-Control", "private, max-age=604800")
        // Third-party bytes: inert wherever opened, and never re-sniffed.
        .setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
        .setHeader("X-Content-Type-Options", "nosniff")
        .send(mark.image.body);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
