import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import {
  authenticate,
  requireAdmin,
  requireWriteScope,
  type AuthRequest,
} from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { getLocationProvider } from "../services/locationProvider/provider";
import {
  holdsTravTrackData,
  travTrackInstanceOn,
  travTrackOffered,
} from "../services/travtrack/availability";
import { setTravTrackConfig, travTrackConfig } from "../services/travtrack/config";
import { travTrackTier } from "./travtrack/gate";

/**
 * TravTrack, the own location history (TravTrack plan, phase 2): the router
 * every `/travtrack/*` path lives under. Bare response family (ADR 0001).
 *
 * Mounted at `/api/v1` beside TravPlan, so later trip-scoped paths can live
 * here too. No router-wide middleware: every route names its own
 * authentication and its gate tier (`routes/travtrack/gate.ts`), because a
 * router mounted at `/api/v1` with a blanket `use` would answer for paths that
 * are not its own.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

/**
 * How a client learns what TravTrack is doing here. `enabled`: the instance
 * captures and shows. `active`: this account's provider is TravTrack and it
 * works. `hasData`: this account holds TravTrack data, so summary, export and
 * delete stay reachable even while TravTrack is off.
 */
router.get(
  "/travtrack/capabilities",
  authenticate,
  travTrackTier("open"),
  route(async (req, res) => {
    const userId = req.userId!;
    const [offered, enabled, provider, hasData] = await Promise.all([
      travTrackOffered(),
      travTrackInstanceOn(),
      getLocationProvider(userId),
      holdsTravTrackData(userId),
    ]);
    res.json({
      version: 1,
      offered,
      enabled,
      active: provider.kind === "travtrack" && provider.status === "ok",
      hasData,
    });
  })
);

const configSchema = z.object({ enabled: z.boolean() }).strict();

router.get(
  "/travtrack/config",
  authenticate,
  travTrackTier("offered"),
  requireAdmin,
  route(async (_req, res) => {
    res.json(await travTrackConfig());
  })
);

router.patch(
  "/travtrack/config",
  authenticate,
  travTrackTier("offered"),
  requireWriteScope,
  rejectDemo,
  requireAdmin,
  route(async (req, res) => {
    res.json(await setTravTrackConfig(configSchema.parse(req.body)));
  })
);

export default router;
