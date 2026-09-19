/**
 * `GET /api/v1/stats/page` — one request, one flight scan, many sections
 * (forgejo#49).
 *
 * Why this exists, in numbers: the statistics page's flight tab issued twelve
 * `/stats/*` requests for one load and the backend answered them with fifteen
 * passes over the flight table, thirteen of them over the identical population
 * (measured 2026-09-19 with a `prisma.$use` spy over the `Flight` model). This
 * route serves eleven of those requests from ONE pass. The composition — and
 * what it deliberately leaves out — is in `services/stats/statsPage.ts`.
 *
 * The per-endpoint routes STAY. The Companion reads them, and the evidence
 * panel cross-checks against them, so this is an additional way to ask the
 * same question and never a replacement. A test compares the two surfaces
 * section by section for exactly that reason.
 *
 * Bare response, like the rest of the stats family
 * (docs/adr/0001-api-response-shape.md). Mounted from `routes/stats.ts`, whose
 * `authenticate` and `statsEtag` middleware therefore apply — this route must
 * not re-add either.
 */

import { Router, Response, NextFunction } from "express";

import { AuthRequest } from "../../middleware/auth";
import { StatsPageQuerySchema } from "../../schemas/statsQuery";
import type { StatsPageSection } from "../../schemas/statsPage";
import { buildStatsPage } from "../../services/stats/statsPage";

const router = Router();

router.get("/page", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = StatsPageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
      return;
    }

    const sections = new Set<StatsPageSection>(parsed.data.include);
    res.json(await buildStatsPage(userId, sections));
  } catch (error) {
    next(error);
  }
});

export default router;
