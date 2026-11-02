import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { kindSwitchSchema } from "../../schemas/roadtrip";
import logger from "../../utils/logger";
import {
  propagateDelete,
  propagateWrite,
  shareSnapshot,
  SHARE_TX_TIMEOUT_MS,
} from "../../services/sharing/propagate";
import { resolveRoute, toDto, ROUTE_SELECT } from "./tourRoutes";

/**
 * Moving a row between the tour and roadtrip pages (design 2026-09-24 §3.4).
 *
 * The 2.7 migration classified every existing section by rule and flagged
 * each one; the owner asked for the rule's decisions to be shown once and
 * be correctable one by one. Switching or confirming clears the flag, so the
 * notice disappears for that row and never comes back.
 *
 * What a switch keeps and drops: the stations' stay links and nights are
 * KEPT when a roadtrip becomes a tour — the tour page ignores them, and a
 * mistaken switch reversed a minute later must not have destroyed the
 * owner's linking. The one field that cannot survive is a tour's anchor: a
 * roadtrip does not set out from a station of another roadtrip.
 */
const router = Router();

router.patch(
  "/tours/:routeId/kind",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, undefined, req.params.routeId);
      const body = kindSwitchSchema.parse(req.body);

      // A roadtrip is shared with the trip's members, a tour never: the switch can make one.
      const route = await prisma.$transaction(
        async (tx) => {
          const before = await shareSnapshot(tx, "roadtrip", routeId);
          const updated = await tx.tripRoute.update({
            where: { id: routeId },
            data:
              body.kind === "tour"
                ? {
                    kind: "tour",
                    activity: body.activity ?? undefined,
                    kindAssignedAutomatically: false,
                  }
                : {
                    kind: "roadtrip",
                    vehicle: body.vehicle ?? undefined,
                    anchorStopId: null,
                    kindAssignedAutomatically: false,
                  },
            include: ROUTE_SELECT,
          });
          if (body.kind === "tour" && before?.shareKey) {
            // A tour is never shared: the members keep their copies and are told.
            await tx.tripRoute.update({ where: { id: routeId }, data: { shareKey: null } });
            await propagateDelete(tx, userId, before);
          } else {
            await propagateWrite(tx, userId, "roadtrip", routeId, before);
          }
          return updated;
        },
        { timeout: SHARE_TX_TIMEOUT_MS }
      );

      logger.info({ operation: "tour.kind.switch", routeId, kind: body.kind });
      res.json({ route: toDto(route) });
    } catch (error) {
      next(error);
    }
  }
);

/** Keep the kind the migration chose; the row leaves the review notice. */
router.post(
  "/tours/:routeId/kind/confirm",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, undefined, req.params.routeId);
      // share-exempt: a review flag on the row, not a fact
      const route = await prisma.tripRoute.update({
        where: { id: routeId },
        data: { kindAssignedAutomatically: false },
        include: ROUTE_SELECT,
      });
      res.json({ route: toDto(route) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
