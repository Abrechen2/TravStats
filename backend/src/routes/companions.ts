import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, AuthRequest, requireWriteScope } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { settingsLimiter, statsLimiter } from "../middleware/rateLimit";
import {
  deleteCompanion,
  deleteUnusedCompanions,
  listManagedCompanions,
  mergeCompanions,
  mergePreview,
  renameCompanion,
} from "../services/companions/manageCompanions";
import { companionTogetherStats } from "../services/companions/companionStats";

const router = Router();

// No rate limiter on the list: one grouped read of the caller's own companion
// links. It feeds a picker that opens on nearly every travel form, so a
// per-user cap here would fire during ordinary data entry and protect nothing
// — the query is bounded by how many people the caller has travelled with.

/**
 * The caller's companions, most used first. Feeds the companion picker in the
 * flight, trip and cruise forms.
 */
router.get("/", authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.companion.findMany({
      where: { userId: req.userId },
      // No orderBy here — final ordering (usageCount desc, then name) is
      // decided in JS below, so a DB-level sort would be redundant work.
      include: {
        _count: {
          select: {
            flights: true,
            trips: true,
            cruises: true,
            rail: true,
            rentals: true,
            bus: true,
            ferry: true,
            // Who paid an expense (forgejo#150): a person the user travels with.
            expensesPaid: true,
          },
        },
      },
    });

    const companions = rows
      .map((row) => ({
        id: row.id,
        name: row.displayName,
        usageCount:
          row._count.flights +
          row._count.trips +
          row._count.cruises +
          row._count.rail +
          row._count.rentals +
          row._count.bus +
          row._count.ferry +
          row._count.expensesPaid,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));

    res.json({ companions });
  } catch (error) {
    next(error);
  }
});

/**
 * Settings → Mitreisende and the overview's "Mit wem unterwegs". Bare, like
 * the list above (ADR 0001). The list and the statistics each fold every
 * shared entry of the caller's — the stats bucket's cost — and the writes are
 * a settings page's: rare, by hand, in the settings bucket.
 */
const idSchema = z.string().min(1).max(100);
export const companionRenameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const companionMergeSchema = z.object({ into: idSchema }).strict();
const mergePreviewQuery = z.object({ into: idSchema });

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
const write = [authenticate, requireWriteScope, rejectDemoWrites, settingsLimiter];

router.get(
  "/manage",
  authenticate,
  statsLimiter,
  handle(async (req, res) => {
    res.json(await listManagedCompanions(req.userId!));
  })
);

router.get(
  "/together",
  authenticate,
  statsLimiter,
  handle(async (req, res) => {
    res.json(await companionTogetherStats(req.userId!));
  })
);

// Before `/:id`, which would otherwise read "unused" as an id.
router.post(
  "/delete-unused",
  ...write,
  handle(async (req, res) => {
    res.json(await deleteUnusedCompanions(req.userId!));
  })
);

router.patch(
  "/:id",
  ...write,
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { name } = companionRenameSchema.parse(req.body ?? {});
    res.json({ companion: await renameCompanion(req.userId!, id, name) });
  })
);

router.get(
  "/:id/merge-preview",
  authenticate,
  settingsLimiter,
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { into } = mergePreviewQuery.parse(req.query);
    res.json({ preview: await mergePreview(req.userId!, id, into) });
  })
);

router.post(
  "/:id/merge",
  ...write,
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { into } = companionMergeSchema.parse(req.body ?? {});
    res.json({ merged: await mergeCompanions(req.userId!, id, into) });
  })
);

router.delete(
  "/:id",
  ...write,
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await deleteCompanion(req.userId!, id);
    res.status(204).end();
  })
);

export default router;
