import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemoWrites } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import {
  PACKING_SHAPE_RICH,
  putPackingListSchema,
  putRichPackingListSchema,
  type RichPackingItem,
} from "../../schemas/companionData";
import { samePrincipal, sameServerAccount, type PackingViewer } from "../../services/packing/items";
import { readVisible, writeVisible } from "../../services/packing/store";
import { assertAssignable } from "../../services/travplan/packingBridge";
import { resolveTrip } from "./resolveTrip";

/**
 * A trip's packing list — `GET`/`PUT /api/v1/trips/:id/packing` (Companion
 * audit 2026-10-23). It lived on the phone only (Companion decision D12)
 * until the owner's rule of 2026-10-20: the server knows everything, the app
 * is a companion. The Companion edits offline and sends the whole list.
 *
 * Two devices never overwrite each other unseen: a write names the `rev` it
 * started from, and a list that moved on since answers 409
 * `PACKING_LIST_STALE` with the stored `rev`; the client reads the list again,
 * replays its own unsent edits on it and sends once more. A resend whose first
 * answer was lost carries the same `mutationId` and is answered from the row,
 * not refused as stale.
 *
 * One store since forgejo#398: TravPlan reads and writes this same list. The
 * default shape stays `{id, label, done}` for the Companion versions already
 * installed; `?shape=rich` carries the full items. A legacy write merges by id
 * and never wipes a field it does not know or an item its caller cannot see.
 * Only the trip's owner reaches these routes; other plan members work through
 * the plan. Bare responses, like every trip router (ADR 0001).
 */

const router = Router();
router.use("/trips/:id/packing", authenticate, requireWriteScope, rejectDemoWrites);

const isRich = (req: AuthRequest): boolean => req.query.shape === PACKING_SHAPE_RICH;
const ownerViewer = (userId: string): PackingViewer => ({
  principal: sameServerAccount(userId),
  isTripOwner: true,
});

router.get("/trips/:id/packing", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const trip = await resolveTrip(req.userId!, req.params.id);
    res.json(await readVisible(trip.id, ownerViewer(req.userId!), isRich(req)));
  } catch (error) {
    next(error);
  }
});

router.put("/trips/:id/packing", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rich = isRich(req);
    const parsed = (rich ? putRichPackingListSchema : putPackingListSchema).safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message ?? "Invalid packing list",
        400,
        "PACKING_LIST_INVALID"
      );
    }
    const userId = req.userId!;
    const trip = await resolveTrip(userId, req.params.id);
    const { items, baseRev, mutationId } = parsed.data;
    if (rich) {
      // An assignee who left the plan stays on the items already assigned to them: the check
      // applies to a NEW assignment only, or one stale assignment would block every edit.
      const stored = new Map(
        ((await readVisible(trip.id, ownerViewer(userId), true)).items as RichPackingItem[]).map(
          (i) => [i.id, i]
        )
      );
      await assertAssignable(
        trip.id,
        userId,
        (items as RichPackingItem[]).flatMap((i) =>
          i.scope === "shared" &&
          i.assigneePrincipal &&
          !(
            stored.get(i.id)?.scope === "shared" &&
            samePrincipal(stored.get(i.id)?.assigneePrincipal ?? null, i.assigneePrincipal)
          )
            ? [i.assigneePrincipal]
            : []
        )
      );
    }
    res.json(
      await writeVisible({
        tripId: trip.id,
        ownerId: userId,
        viewer: ownerViewer(userId),
        items,
        baseRev,
        mutationId,
        rich,
      })
    );
  } catch (error) {
    next(error);
  }
});

export default router;
