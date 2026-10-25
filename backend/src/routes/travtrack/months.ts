import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { travTrackCityLookupSchema, travTrackMonthsQuerySchema } from "../../schemas/travtrack";
import {
  setTravTrackCityLookup,
  travTrackCityLookup,
  travTrackMonths,
} from "../../services/travtrack/months/read";
import { travTrackTier } from "./gate";

/**
 * TravTrack's monthly values (TravTrack plan L3): `GET /travtrack/months?year=`
 * — per UTC month the ground kilometres, the countries and, when switched on,
 * the cities — and the account's city-lookup switch. Tier `on`: views and
 * their setting. Bare (ADR 0001), own account only, `no-store` by the `/api`
 * default.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

router.get(
  "/travtrack/months",
  authenticate,
  travTrackTier("on"),
  route(async (req, res) => {
    const { year } = travTrackMonthsQuerySchema.parse(req.query);
    res.json(await travTrackMonths(req.userId!, year));
  })
);

router.get(
  "/travtrack/city-lookup",
  authenticate,
  travTrackTier("on"),
  route(async (req, res) => {
    res.json({ enabled: await travTrackCityLookup(req.userId!) });
  })
);

router.put(
  "/travtrack/city-lookup",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const { enabled } = travTrackCityLookupSchema.parse(req.body);
    res.json({ enabled: await setTravTrackCityLookup(req.userId!, enabled) });
  })
);

export default router;
