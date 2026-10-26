import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { travTrackZoneCreateSchema, travTrackZoneUpdateSchema } from "../../schemas/travtrack";
import { createZone, deleteZone, listZones, updateZone } from "../../services/travtrack/zones";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * TravTrack's privacy zones (TravTrack plan T3). GET is what the phone syncs
 * to drop fixes on the device; a paired device may read and write zones, a
 * read-only token may only read. A write that would delete stored positions
 * answers 409 LOCATION_ZONE_HOLDS_POINTS with `pointsInside` until it is sent
 * again with `deleteStoredPoints: true`; the answer then names `deleted`.
 *
 * Tiers: list and delete are `held` (TravTrack off still lets an account see
 * and remove what it has), create and update are `on` (a new zone is new
 * configuration of capture).
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

router.get(
  "/travtrack/zones",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    res.json({ zones: await listZones(req.userId!) });
  })
);

router.post(
  "/travtrack/zones",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const { deleteStoredPoints, ...zone } = travTrackZoneCreateSchema.parse(req.body);
    const result = await createZone(req.userId!, zone, deleteStoredPoints);
    logger.info({ operation: "travtrack.zones.create", deleted: result.deleted });
    res.status(201).json(result);
  })
);

router.patch(
  "/travtrack/zones/:id",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const { deleteStoredPoints, ...patch } = travTrackZoneUpdateSchema.parse(req.body);
    const result = await updateZone(req.userId!, String(req.params.id), patch, deleteStoredPoints);
    logger.info({ operation: "travtrack.zones.update", deleted: result.deleted });
    res.json(result);
  })
);

router.delete(
  "/travtrack/zones/:id",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    await deleteZone(req.userId!, String(req.params.id));
    res.status(204).end();
  })
);

export default router;
