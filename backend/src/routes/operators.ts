import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { airlineLogoLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  OPERATOR_DOMAINS,
  resolveOperatorMark,
} from "../services/operatorLogos/operatorMarkService";

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

/** GET /operators/mark?domain=ferry&name=Stena%20Line — whether a logo exists, and its credit. */
router.get(
  "/mark",
  airlineLogoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { domain, name } = parse(req.query);
      const mark = await resolveOperatorMark(domain, name);
      // `private`: an /api answer is never for a shared cache (CLAUDE.md).
      res.setHeader("Cache-Control", "private, max-age=3600").json({
        success: true,
        data: mark
          ? { available: true, source: mark.source, credit: mark.credit }
          : { available: false, source: null, credit: null },
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
      const { domain, name } = parse(req.query);
      const mark = await resolveOperatorMark(domain, name);
      if (!mark) {
        res
          .status(404)
          .setHeader("Cache-Control", "private, max-age=3600")
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
