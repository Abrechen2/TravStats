import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { airlineLogoLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { railOperators, findRailOperator } from "../../services/rail/operatorCatalog";
import { resolveCataloguedProviderLogo } from "../../services/rentalProviders/providerLogoService";

/**
 * The rail-operator catalogue: the common companies as
 * suggestions for the free-text provider field, and their logos. Mounted
 * ahead of the rail router, whose '/:id' would otherwise answer it.
 * Enveloped like the rest of `/rail` (ADR 0001).
 */
const router = Router();
router.use(authenticate);

/** GET /rail/operators — the catalogue, in suggestion order. */
router.get("/", (_req: AuthRequest, res: Response): void => {
  res.json({
    success: true,
    data: railOperators().map((p) => ({ id: p.id, name: p.name })),
  });
});

const logoQuerySchema = z.object({ name: z.string().trim().min(1).max(120) });

/**
 * GET /rail/operators/logo?name=DB — the logo of the operator a journey
 * names, or 404 when it names no catalogued company or no source has a logo.
 * The client draws the monogram for a 404; nothing here ever answers with a
 * stand-in image.
 */
router.get(
  "/logo",
  airlineLogoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = logoQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError("A provider name is required", 400);
      const logo = await resolveCataloguedProviderLogo(findRailOperator(parsed.data.name));
      if (!logo) {
        // Cached privately for an hour: a list of rails asks this for every
        // row, and a provider without a logo is not going to grow one by the
        // next page view.
        res
          .status(404)
          .setHeader("Cache-Control", "private, max-age=3600")
          .json({ success: false, error: "No logo available" });
        return;
      }
      res
        .setHeader("Content-Type", logo.contentType)
        .setHeader("Cache-Control", "private, max-age=604800")
        // Third-party bytes: inert wherever opened, and never re-sniffed.
        .setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
        .setHeader("X-Content-Type-Options", "nosniff")
        .send(logo.body);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
