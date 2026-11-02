/** TravPlan co-planners on this server (forgejo#404, spec §6.1-6.6); bare response family. */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import {
  collab,
  inviteLocalMember,
  leavePlan,
  listInvitations,
  markNoticesRead,
  respondToInvitation,
  revokeMember,
  shareWithMemberFor,
} from "../../services/travplan/members";

import {
  eligiblePlanConnections,
  inviteRemoteMember,
} from "../../services/sharing/federation/plans/hostInvite";

const router = Router();
const uuid = z.string().uuid();
const route =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const write = [authenticate, requireWriteScope, rejectDemo] as const;
const trip = (req: AuthRequest) => uuid.parse(req.params.tripId);

// Who is on the plan, as whom the caller acts, and what the others changed since they last looked.
router.get(
  "/trips/:tripId/plan/collab",
  authenticate,
  route(async (req, res) => {
    res.json(await collab(req.userId!, trip(req)));
  })
);

router.post(
  "/trips/:tripId/plan/notices/read",
  ...write,
  route(async (req, res) => {
    res.json(await markNoticesRead(req.userId!, trip(req)));
  })
);

router.post(
  "/trips/:tripId/plan/members",
  ...write,
  route(async (req, res) => {
    // A person on this server by name, or a connected person on another server by connection
    // (spec 2026-11-02 §4); never both.
    const body = z
      .union([
        z.object({ username: z.string().trim().min(1).max(100) }).strict(),
        z.object({ connectionId: uuid }).strict(),
      ])
      .parse(req.body);
    res
      .status(201)
      .json(
        "connectionId" in body
          ? await inviteRemoteMember(req.userId!, trip(req), body.connectionId)
          : await inviteLocalMember(req.userId!, trip(req), body.username)
      );
  })
);

// Owner: the connections that can be invited into this plan ("Mitplaner hinzufügen").
router.get(
  "/trips/:tripId/plan/members/connections",
  authenticate,
  route(async (req, res) => {
    res.json({ connections: await eligiblePlanConnections(req.userId!, trip(req)) });
  })
);

router.delete(
  "/trips/:tripId/plan/members/:memberId",
  ...write,
  route(async (req, res) => {
    res.json(await revokeMember(req.userId!, trip(req), uuid.parse(req.params.memberId)));
  })
);

// Owner: give one member the linked copy of the trip now (a handover does it for all).
router.post(
  "/trips/:tripId/plan/members/:memberId/share",
  ...write,
  route(async (req, res) => {
    res.json(await shareWithMemberFor(req.userId!, trip(req), uuid.parse(req.params.memberId)));
  })
);

router.post(
  "/trips/:tripId/plan/leave",
  ...write,
  route(async (req, res) => {
    res.json(await leavePlan(req.userId!, trip(req)));
  })
);

router.get(
  "/travplan/invitations",
  authenticate,
  route(async (req, res) => {
    res.json({ invitations: await listInvitations(req.userId!) });
  })
);

router.post(
  "/travplan/invitations/:memberId/:answer",
  ...write,
  route(async (req, res) => {
    const answer = z.enum(["accept", "decline"]).parse(req.params.answer);
    res.json(
      await respondToInvitation(req.userId!, uuid.parse(req.params.memberId), answer === "accept")
    );
  })
);

export default router;
