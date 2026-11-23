import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { railRoutingBaseUrl } from "../../services/rail/openRailRouting";
import {
  cancelRerouteRun,
  latestInstanceRun,
  startRerouteRun,
} from "../../services/tour/routing/rerouteRun";

/**
 * The administrator's bulk re-route of every account's straight legs
 * (forgejo#436), under Administration -> external services. State lives in
 * `reroute_runs`; the client polls `GET`, there is no job id to lose.
 *
 *  - `GET  /instance-settings/routing/reroute` -> `{ run }` (latest, or null)
 *  - `POST /instance-settings/routing/reroute` `{ mode: "straight" | "all" }`
 *    -> 202 `{ run }`; 409 `notConfigured` without a usable provider,
 *    409 `alreadyActive` (with the run) while one is running or paused
 *  - `POST /instance-settings/routing/reroute/:id/cancel` -> `{ run }`
 *
 * Rail journeys are their own scope (`rail`), walked through the self-hosted
 * rail router instead of a road provider:
 *  - `GET  /instance-settings/routing/reroute-rail` -> `{ run, straightJourneys,
 *    routerConfigured }` (the count is what a "N rides as straight lines" note reads)
 *  - `POST /instance-settings/routing/reroute-rail` `{ mode }` -> 202 `{ run }`;
 *    409 `notConfigured` without a rail router, 409 `alreadyActive`
 *  - `POST /instance-settings/routing/reroute-rail/:id/cancel` -> `{ run }`
 */
const router = Router();

const startSchema = z.object({ mode: z.enum(["straight", "all"]).default("straight") });

router.get(
  "/instance-settings/routing/reroute",
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ run: await latestInstanceRun() });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/instance-settings/routing/reroute",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { mode } = startSchema.parse(req.body ?? {});
      const start = await startRerouteRun(req.userId!, { scope: "instance", routeId: null, mode });
      if (start.kind === "started") {
        res.status(202).json({ run: start.run });
        return;
      }
      if (start.kind === "alreadyActive") {
        res
          .status(409)
          .json({ error: "A re-route is already running", code: start.kind, run: start.run });
        return;
      }
      res.status(409).json({ error: "No routing provider is configured", code: start.kind });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/instance-settings/routing/reroute/:id/cancel",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const run = await cancelRerouteRun(req.params.id, { scope: "instance" });
      if (!run) throw new AppError("Run not found", 404);
      res.json({ run });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/instance-settings/routing/reroute-rail",
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const [run, straightJourneys, baseUrl] = await Promise.all([
        latestInstanceRun("rail"),
        prisma.railJourney.count({ where: { geometrySource: "straight" } }),
        railRoutingBaseUrl(),
      ]);
      res.json({ run, straightJourneys, routerConfigured: baseUrl !== null });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/instance-settings/routing/reroute-rail",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { mode } = startSchema.parse(req.body ?? {});
      const start = await startRerouteRun(req.userId!, { scope: "rail", routeId: null, mode });
      if (start.kind === "started") {
        res.status(202).json({ run: start.run });
        return;
      }
      if (start.kind === "alreadyActive") {
        res
          .status(409)
          .json({ error: "A re-route is already running", code: start.kind, run: start.run });
        return;
      }
      res.status(409).json({ error: "No rail routing service is configured", code: start.kind });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/instance-settings/routing/reroute-rail/:id/cancel",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const run = await cancelRerouteRun(req.params.id, { scope: "rail" });
      if (!run) throw new AppError("Run not found", 404);
      res.json({ run });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
