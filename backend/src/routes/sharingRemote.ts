import { Router, type NextFunction, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { tripFederationAvailability } from "../services/sharing/federation/availability";
import { claimTripInvite } from "../services/sharing/federation/claim";
import { requireTripFederation } from "../services/sharing/federation/access";
import {
  createTripInvite,
  listTripInvites,
  revokeTripInvite,
} from "../services/sharing/federation/invites";
import { listRemotePeople } from "../services/sharing/federation/remotePeople";
import { offerTrip } from "../services/sharing/federation/offers";
import {
  acceptOffer,
  declineOffer,
  listReceivedOffers,
} from "../services/sharing/federation/offerInbox";
import { tripRemoteSharing } from "../services/sharing/federation/tripRemoteSharing";
import {
  dismissParked,
  reconfirmTrip,
  withdrawRemoteConsent,
} from "../services/sharing/federation/lifecycle";
import { decideRosterPerson } from "../services/sharing/federation/roster";
import { requestAddition } from "../services/sharing/federation/addRequest";
import {
  addRequestBodySchema,
  remoteClaimBodySchema,
  remoteMemberIdSchema,
  rosterDecisionBodySchema,
  rosterRefSchema,
  remoteInviteIdSchema,
  remoteOfferBodySchema,
  remoteOfferIdSchema,
  remoteTripIdSchema,
} from "../schemas/sharingRemote";

/**
 * `/api/v1/sharing/remote` — people on other TravStats servers (spec 2026-10-20, phases F-S4b and
 * F-S4c): issue, list and revoke an invitation code, redeem one from another server, list the
 * people one is paired with; a trip's people on other servers, offering it to one of them or by a
 * trip page's code; the offers one received, and the answer to each; and since F-S4e the end and
 * pause of it all — withdrawing a person, answering a newcomer on a trip's roster, confirming held
 * memberships again, dismissing refused messages, asking a trip's home to add someone. Enveloped
 * like `/sharing` (ADR 0001). Everything but `/status` refuses with
 * `SHARE_REMOTE_DISABLED` (404) while the feature is off; `/status` says whether it is on, so a
 * screen can draw nothing instead of a button that always fails.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);

/**
 * Codes issued and redeemed, per user: 30 an hour. A claim makes this server contact another
 * one; an unbounded endpoint would let one account drive that traffic. The key masks addresses
 * through `ipKeyGenerator`, as express-rate-limit 8 demands.
 */
const remoteInviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many invitation requests, please try again later", code: "RATE_LIMITED" },
  keyGenerator: (req: Request): string => {
    const userId = (req as { userId?: string }).userId;
    if (userId) return `share-remote:${userId}`;
    return `share-remote-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
  },
});

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
  "/status",
  handle(async (_req, res) => {
    const state = await tripFederationAvailability();
    res.json({
      success: true,
      data: state.available
        ? { available: true, reason: null, origin: state.identity.origin }
        : { available: false, reason: state.reason, origin: null },
    });
  })
);

/**
 * Off means off before anything else is judged: the switch is asked ahead of
 * every body and parameter, so a claim while the feature is off answers
 * `SHARE_REMOTE_DISABLED` like every other endpoint, not "invalid code"
 * (beta.22 UAT). Registered after `/status`, which answers while off.
 */
router.use(async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
  try {
    await requireTripFederation(req.userId!);
    next();
  } catch (err) {
    next(err);
  }
});

router.get(
  "/invites",
  handle(async (req, res) => {
    res.json({ success: true, data: await listTripInvites(req.userId!) });
  })
);

router.post(
  "/invites",
  remoteInviteLimiter,
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: await createTripInvite(req.userId!) });
  })
);

router.delete(
  "/invites/:id",
  handle(async (req, res) => {
    await revokeTripInvite(req.userId!, remoteInviteIdSchema.parse(req.params.id));
    res.json({ success: true, data: { revoked: true } });
  })
);

router.post(
  "/claim",
  remoteInviteLimiter,
  handle(async (req, res) => {
    const { code } = remoteClaimBodySchema.parse(req.body ?? {});
    const person = await claimTripInvite(req.userId!, code);
    // A retry of a code this account redeemed already: the pairing existed, nothing was created.
    res.status(person.alreadyConnected ? 200 : 201).json({ success: true, data: person });
  })
);

router.get(
  "/people",
  handle(async (req, res) => {
    res.json({ success: true, data: await listRemotePeople(req.userId!) });
  })
);

router.get(
  "/trips/:tripId",
  handle(async (req, res) => {
    const tripId = remoteTripIdSchema.parse(req.params.tripId);
    res.json({ success: true, data: await tripRemoteSharing(req.userId!, tripId) });
  })
);

// Each of these makes this server contact another one, so they share the invitation limit.
router.post(
  "/trips/:tripId/offers",
  remoteInviteLimiter,
  handle(async (req, res) => {
    const tripId = remoteTripIdSchema.parse(req.params.tripId);
    const { remoteId } = remoteOfferBodySchema.parse(req.body ?? {});
    res.status(201).json({ success: true, data: await offerTrip(req.userId!, tripId, remoteId) });
  })
);

router.post(
  "/trips/:tripId/invites",
  remoteInviteLimiter,
  handle(async (req, res) => {
    const tripId = remoteTripIdSchema.parse(req.params.tripId);
    res.status(201).json({ success: true, data: await createTripInvite(req.userId!, tripId) });
  })
);

router.get(
  "/offers",
  handle(async (req, res) => {
    res.json({ success: true, data: await listReceivedOffers(req.userId!) });
  })
);

router.post(
  "/offers/:id/accept",
  remoteInviteLimiter,
  handle(async (req, res) => {
    const id = remoteOfferIdSchema.parse(req.params.id);
    res.json({ success: true, data: await acceptOffer(req.userId!, id) });
  })
);

router.post(
  "/offers/:id/decline",
  remoteInviteLimiter,
  handle(async (req, res) => {
    await declineOffer(req.userId!, remoteOfferIdSchema.parse(req.params.id));
    res.json({ success: true, data: { declined: true } });
  })
);

// The lifecycle (F-S4e): withdraw a person's consent, answer a newcomer on a trip's roster,
// confirm held memberships again, dismiss refused messages, ask the home to add someone.
router.post(
  "/people/:id/withdraw",
  handle(async (req, res) => {
    const id = remoteInviteIdSchema.parse(req.params.id);
    res.json({ success: true, data: await withdrawRemoteConsent(req.userId!, id) });
  })
);

router.post(
  "/trips/:tripId/roster/:ref",
  handle(async (req, res) => {
    const tripId = remoteTripIdSchema.parse(req.params.tripId);
    const ref = rosterRefSchema.parse(req.params.ref);
    const { decision } = rosterDecisionBodySchema.parse(req.body ?? {});
    await decideRosterPerson(req.userId!, tripId, ref, decision);
    res.json({ success: true, data: await tripRemoteSharing(req.userId!, tripId) });
  })
);

router.post(
  "/trips/:tripId/reconfirm",
  handle(async (req, res) => {
    const tripId = remoteTripIdSchema.parse(req.params.tripId);
    await reconfirmTrip(req.userId!, tripId);
    res.json({ success: true, data: await tripRemoteSharing(req.userId!, tripId) });
  })
);

router.delete(
  "/trips/:tripId/members/:memberId/parked",
  handle(async (req, res) => {
    const tripId = remoteTripIdSchema.parse(req.params.tripId);
    const memberId = remoteMemberIdSchema.parse(req.params.memberId);
    await dismissParked(req.userId!, tripId, memberId);
    res.json({ success: true, data: await tripRemoteSharing(req.userId!, tripId) });
  })
);

router.post(
  "/trips/:tripId/add-requests",
  remoteInviteLimiter,
  handle(async (req, res) => {
    const tripId = remoteTripIdSchema.parse(req.params.tripId);
    const body = addRequestBodySchema.parse(req.body ?? {});
    res.status(201).json({ success: true, data: await requestAddition(req.userId!, tripId, body) });
  })
);

export default router;
