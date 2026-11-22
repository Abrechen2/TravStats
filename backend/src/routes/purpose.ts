import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { PURPOSES } from "../shared/purpose";
import { PURPOSE_ENTRY_TYPES, purposeVisibilitySchema, setPurposeSchema } from "../schemas/purpose";
import {
  loadPurposeVisibilitySetting,
  purposeVisibilityRevision,
} from "../services/provenance/purposeVisibility";
import { runUnfiltered } from "../services/provenance/recordedOnly";
import { countHiddenByPurpose } from "../services/purpose/hiddenCounts";
import { setEntryPurpose } from "../services/purpose/setPurpose";
import { applyTripPurpose, fillPurposeFromTrips } from "../services/purpose/tripActions";
import type { Prisma } from "../prisma";

/**
 * `/api/v1/purpose` — private or business (docs/superpowers/specs/2026-11-22-private-business-purpose.md).
 *
 * `PUT /entries/:entryType/:id` sets or clears one entry's purpose. `GET|PUT /visibility` is the
 * per-domain "ausblenden" setting, answered with its revision (also sent as `X-Purpose-Visibility`
 * on every scoped read). `GET /hidden` counts what the setting hides, for the hint under totals.
 * Own entries only. Enveloped.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const entryParams = z.object({ entryType: z.enum(PURPOSE_ENTRY_TYPES), id: z.string().uuid() });

router.put(
  "/entries/:entryType/:id",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { entryType, id } = entryParams.parse(req.params);
      const body = setPurposeSchema.parse(req.body ?? {});
      const purpose = await setEntryPurpose(req.userId!, entryType, id, body.purpose);
      if (purpose === undefined) {
        res.status(404).json({ success: false, error: "Entry not found", code: "ENTRY_NOT_FOUND" });
        return;
      }
      res.json({ success: true, data: { purpose } });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/visibility",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const visibility = await loadPurposeVisibilitySetting(req.userId!);
      res.json({
        success: true,
        data: { visibility, revision: purposeVisibilityRevision(visibility) },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/visibility",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const visibility = purposeVisibilitySchema.parse(req.body ?? {});
      const value = visibility as unknown as Prisma.InputJsonValue;
      await runUnfiltered(() =>
        prisma.userSettings.upsert({
          where: { userId: req.userId! },
          update: { purposeVisibility: value },
          create: { userId: req.userId!, data: {}, purposeVisibility: value },
        })
      );
      res.json({
        success: true,
        data: { visibility, revision: purposeVisibilityRevision(visibility) },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/hidden",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: { hidden: await countHiddenByPurpose(req.userId!) } });
    } catch (err) {
      next(err);
    }
  }
);

const tripParams = z.object({ tripId: z.string().uuid() });
const applyBody = z.object({ purpose: z.enum(PURPOSES).optional() }).strict();

/** "Zweck auf alle Einträge übertragen": the trip's purpose onto every entry of that trip. */
router.post(
  "/trips/:tripId/apply",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tripId } = tripParams.parse(req.params);
      const body = applyBody.parse(req.body ?? {});
      const result = await applyTripPurpose(req.userId!, tripId, body.purpose);
      if (!result) {
        res.status(404).json({ success: false, error: "Trip not found", code: "TRIP_NOT_FOUND" });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/** "Zweck aus der Reise-Kategorie übernehmen": one-off, fills only entries without a purpose. */
router.post(
  "/from-trips",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: { changed: await fillPurposeFromTrips(req.userId!) } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
