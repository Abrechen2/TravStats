import { Router, type NextFunction, type Response } from "express";
import { recheckAchievements } from "../utils/achievements";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import {
  PURPOSE_ENTRY_TYPES,
  customPurposeCreateSchema,
  customPurposeUpdateSchema,
  purposeValue,
  purposeVisibilitySchema,
  setPurposeSchema,
} from "../schemas/purpose";
import {
  loadPurposeVisibilitySetting,
  purposeVisibilityRevision,
} from "../services/provenance/purposeVisibility";
import { runUnfiltered } from "../services/provenance/recordedOnly";
import { countHiddenByPurpose } from "../services/purpose/hiddenCounts";
import { setEntryPurpose } from "../services/purpose/setPurpose";
import {
  applyTripPurpose,
  fillPurposeFromTrips,
  previewTripPurpose,
  resolveChosenPurpose,
} from "../services/purpose/tripActions";
import { purposeUsage } from "../services/purpose/purposeUsage";
import {
  createCustomPurpose,
  deleteCustomPurpose,
  purposeCatalogue,
  updateCustomPurpose,
} from "../services/purpose/customPurposes";
import type { Prisma } from "../prisma";

/**
 * `/api/v1/purpose` — private or business (docs/superpowers/specs/2026-11-22-private-business-purpose.md).
 *
 * `PUT /entries/:entryType/:id` sets or clears one entry's purpose. `GET|PUT /visibility` is the
 * per-domain "ausblenden" setting, answered with its revision (also sent as `X-Purpose-Visibility`
 * on every scoped read). `GET /hidden` counts what the setting hides, for the hint under totals.
 * `GET /catalogue` lists the built-in purposes and the caller's own; `POST|PATCH|DELETE /custom`
 * manages the own ones (delete only while unused). A purpose is a legacy kind or a detailed key
 * (`builtin:<key>` | `custom:<uuid>`). Own entries only. Enveloped.
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
      const stored = await setEntryPurpose(req.userId!, entryType, id, body.purpose);
      if (stored === undefined) {
        res.status(404).json({ success: false, error: "Entry not found", code: "ENTRY_NOT_FOUND" });
        return;
      }
      // A hidden entry earns no badge: whatever the purpose change hides or shows is re-derived.
      await recheckAchievements(req.userId!, "purpose-entry");
      res.json({
        success: true,
        data: { purpose: stored.purpose, purposeKey: stored.purposeKey },
      });
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
      // Stored badges are not derived per request: re-derive them so hidden entries stop
      // counting (and shown ones count again).
      await recheckAchievements(req.userId!, "purpose-visibility");
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
const applyBody = z.object({ purpose: purposeValue.optional() }).strict();

/** What the apply below would change, so the page can ask first with the count (UAT rc.45). */
router.get(
  "/trips/:tripId/apply",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tripId } = tripParams.parse(req.params);
      const asked = purposeValue.optional().parse(req.query.purpose);
      const chosen = await resolveChosenPurpose(req.userId!, asked);
      const result = await previewTripPurpose(req.userId!, tripId, chosen);
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

/** "Zweck auf alle Einträge übertragen": the trip's purpose onto every entry of that trip. */
router.post(
  "/trips/:tripId/apply",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tripId } = tripParams.parse(req.params);
      const body = applyBody.parse(req.body ?? {});
      const chosen = await resolveChosenPurpose(req.userId!, body.purpose);
      const result = await applyTripPurpose(req.userId!, tripId, chosen);
      if (!result) {
        res.status(404).json({ success: false, error: "Trip not found", code: "TRIP_NOT_FOUND" });
        return;
      }
      await recheckAchievements(req.userId!, "purpose-trip-apply");
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
      const changed = await fillPurposeFromTrips(req.userId!);
      await recheckAchievements(req.userId!, "purpose-from-trips");
      res.json({ success: true, data: { changed } });
    } catch (err) {
      next(err);
    }
  }
);

/** Entries per purpose and domain, for the counts beside the purpose filter's options. */
router.get("/usage", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: { usage: await purposeUsage(req.userId!) } });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/catalogue",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await purposeCatalogue(req.userId!) });
    } catch (err) {
      next(err);
    }
  }
);

const customParams = z.object({ id: z.string().uuid() });
const notFound = (res: Response): void => {
  res.status(404).json({ success: false, error: "Purpose not found", code: "PURPOSE_NOT_FOUND" });
};

router.post(
  "/custom",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = customPurposeCreateSchema.parse(req.body ?? {});
      res.status(201).json({ success: true, data: await createCustomPurpose(req.userId!, body) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/custom/:id",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = customParams.parse(req.params);
      const body = customPurposeUpdateSchema.parse(req.body ?? {});
      const updated = await updateCustomPurpose(req.userId!, id, body);
      if (!updated) return notFound(res);
      // A changed kind moves entries between private and business: badges follow.
      if (body.kind) await recheckAchievements(req.userId!, "purpose-custom-kind");
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/custom/:id",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = customParams.parse(req.params);
      const result = await deleteCustomPurpose(req.userId!, id);
      if (result === "not-found") return notFound(res);
      if (result === "in-use") {
        res.status(409).json({
          success: false,
          error: "Purpose in use; archive it instead",
          code: "PURPOSE_IN_USE",
        });
        return;
      }
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
