import type { NextFunction, RequestHandler, Response } from "express";

import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import {
  assertTravTrackOffered,
  holdsTravTrackData,
  travTrackInstanceOn,
} from "../../services/travtrack/availability";

/**
 * The gate tiers of every TravTrack route (TravTrack plan T1, review focus 14).
 * Not one blanket gate: TravTrack switched off means no new capture and
 * nothing deleted, while export and delete stay reachable for whoever holds
 * data — so each route names which of four questions decides it.
 *
 *   - `open`    answers whatever the switches say (`GET /travtrack/capabilities`).
 *   - `offered` needs the beta switch only: the admin config, so the switch
 *               that turns TravTrack on is reachable while it is off.
 *   - `on`      captures or derives: the instance must be on.
 *   - `held`    summary, export, delete, zone list and delete: the instance is
 *               on, OR this account holds TravTrack data.
 *
 * Mount AFTER `authenticate` (`held` reads `req.userId`). Each middleware
 * carries its tier, and `travtrack.gate.test.ts` walks the router and fails
 * on any route without one.
 */

export type TravTrackTier = "open" | "offered" | "on" | "held";

export type TieredHandler = RequestHandler & { travTrackTier: TravTrackTier };

const disabled = (): AppError =>
  new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");

async function allowed(tier: TravTrackTier, req: AuthRequest): Promise<void> {
  if (tier === "open") return;
  if (tier === "offered") return assertTravTrackOffered();
  if (await travTrackInstanceOn()) return;
  if (tier === "held" && req.userId && (await holdsTravTrackData(req.userId))) return;
  throw disabled();
}

export function travTrackTier(tier: TravTrackTier): TieredHandler {
  const handler = (req: AuthRequest, _res: Response, next: NextFunction): void => {
    allowed(tier, req).then(() => next(), next);
  };
  return Object.assign(handler, { travTrackTier: tier }) as TieredHandler;
}
