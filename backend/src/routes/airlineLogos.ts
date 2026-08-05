import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { airlineLogoLimiter } from "../middleware/rateLimit";
import { resolveAirlineLogo, type LogoVariant } from "../services/airlineLogo/airlineLogoService";

const paramsSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{2,3}$/, "IATA (2) or ICAO (3) code expected"),
});
const querySchema = z.object({
  variant: z.enum(["icon", "logo", "logo-white", "tail"]).default("icon"),
});

const router = Router();

// Authenticated, cached proxy for airline logos (icon/logo/logo-white/tail).
// resolveAirlineLogo() checks disk cache first, then falls back to the
// logostream/daisycon upstreams — see airlineLogoService.ts. The rate
// limiter runs before authenticate (same ordering as appSettings.ts), so it
// buckets by IP until the request is authenticated; that's the established
// pattern for this codebase's per-route limiters.
router.get(
  "/:code",
  airlineLogoLimiter,
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = paramsSchema.safeParse(req.params);
      const query = querySchema.safeParse(req.query);
      if (!params.success || !query.success) {
        res.status(400).json({ error: "Invalid airline code or variant" });
        return;
      }
      const code = params.data.code.toUpperCase();
      const logo = await resolveAirlineLogo(code, query.data.variant as LogoVariant);
      if (!logo) {
        res.status(404).json({ error: "No logo available" });
        return;
      }
      res
        .setHeader("Content-Type", logo.contentType)
        .setHeader("Cache-Control", "private, max-age=604800")
        // The vendored tier serves SVG, and an SVG opened as a top-level
        // document may execute script in this origin. The assets are ours and
        // trusted, but this route is one snapshot refresh away from carrying
        // third-party markup we did not read line by line. `default-src 'none'`
        // makes the file inert wherever it is opened; `nosniff` stops a browser
        // from re-interpreting a raster response as markup.
        .setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .setHeader("X-Content-Type-Options", "nosniff")
        .send(logo.body);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
