import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { shareConsentRequestLimiter } from "../middleware/sharingRateLimit";
import {
  linkCompanion,
  listLinkableCompanions,
  unlinkCompanion,
} from "../services/sharing/companionLink";
import {
  decideConsent,
  listConsents,
  requestConsent,
  withdrawConsent,
} from "../services/sharing/consent";
import { inboxCount, listNotices, markNoticeRead } from "../services/sharing/notices";
import { leaveGroup, shareTrip, tripSharingView } from "../services/sharing/shareTrip";
import { deleteOwnCopy, undoNotice } from "../services/sharing/undo";

/**
 * `/api/v1/sharing` — shared trips, phases S1 and S2 (design
 * `docs/superpowers/specs/2026-10-09-trip-sharing-design.md`): consent between
 * two accounts, a companion linked to an account, a trip copied into a linked
 * companion's account, and leaving a share group again.
 *
 * Enveloped (`{success, data}`, ADR 0001). Every lookup is scoped to the
 * caller: an id of another account's consent, companion, trip or notice
 * answers exactly like an id that does not exist. The shared demo account
 * (every visitor of a public instance at once) may read but not share.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);

const idSchema = z.string().min(1).max(100);
export const consentRequestSchema = z
  .object({ username: z.string().trim().min(1).max(100) })
  .strict();
export const companionLinkSchema = z.object({ userId: idSchema }).strict();
export const shareTripSchema = z.object({ companionId: idSchema }).strict();

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

router.get(
  "/consents",
  handle(async (req, res) => {
    res.json({ success: true, data: await listConsents(req.userId!) });
  })
);

router.post(
  "/consents",
  shareConsentRequestLimiter,
  handle(async (req, res) => {
    const { username } = consentRequestSchema.parse(req.body ?? {});
    res.status(201).json({ success: true, data: await requestConsent(req.userId!, username) });
  })
);

router.post(
  "/consents/:id/accept",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await decideConsent(req.userId!, id, "accepted") });
  })
);

router.post(
  "/consents/:id/decline",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await decideConsent(req.userId!, id, "declined") });
  })
);

router.post(
  "/consents/:id/withdraw",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await withdrawConsent(req.userId!, id) });
  })
);

router.get(
  "/companions",
  handle(async (req, res) => {
    res.json({ success: true, data: await listLinkableCompanions(req.userId!) });
  })
);

router.put(
  "/companions/:id/link",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { userId } = companionLinkSchema.parse(req.body ?? {});
    res.json({ success: true, data: await linkCompanion(req.userId!, id, userId) });
  })
);

router.delete(
  "/companions/:id/link",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await unlinkCompanion(req.userId!, id) });
  })
);

router.get(
  "/trips/:tripId",
  handle(async (req, res) => {
    const tripId = idSchema.parse(req.params.tripId);
    res.json({ success: true, data: await tripSharingView(req.userId!, tripId) });
  })
);

router.post(
  "/trips/:tripId/share",
  handle(async (req, res) => {
    const tripId = idSchema.parse(req.params.tripId);
    const { companionId } = shareTripSchema.parse(req.body ?? {});
    res.json({ success: true, data: await shareTrip(req.userId!, tripId, companionId) });
  })
);

router.post(
  "/trips/:tripId/leave",
  handle(async (req, res) => {
    const tripId = idSchema.parse(req.params.tripId);
    res.json({ success: true, data: await leaveGroup(req.userId!, tripId) });
  })
);

router.get(
  "/notices",
  handle(async (req, res) => {
    res.json({ success: true, data: { notices: await listNotices(req.userId!) } });
  })
);

router.post(
  "/notices/:id/read",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await markNoticeRead(req.userId!, id);
    res.json({ success: true, data: { read: true } });
  })
);

router.post(
  "/notices/:id/undo",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await undoNotice(req.userId!, id) });
  })
);

router.post(
  "/notices/:id/delete-copy",
  handle(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await deleteOwnCopy(req.userId!, id) });
  })
);

/** The inbox badge's share. Unlimited: the navigation polls it; two counts. */
router.get(
  "/inbox/count",
  handle(async (req, res) => {
    res.json({ success: true, data: { count: await inboxCount(req.userId!) } });
  })
);

export default router;
