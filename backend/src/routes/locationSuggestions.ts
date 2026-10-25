import { Router } from "express";

import { z } from "../schemas/zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { rejectSuggestion, SUGGESTION_SELECT } from "../services/locationEvidence/suggestionStore";
import { acceptCountrySuggestion } from "../services/locationEvidence/countryAccept";
import { toEnvelope } from "../services/locationEvidence/envelope";
import type { EvidenceSuggested } from "../services/locationEvidence/types";

/**
 * What location history asks the user (TravTrack plan E6; E7 adds journeys):
 * `/api/v1/location-suggestions`, enveloped like `dawarichStays.ts`. Rows go
 * out as `EvidenceSuggested` only — the evidence key, the evidence and any
 * digest stay on the server.
 *
 * Listing and rejecting work with TravTrack switched off; accepting a
 * TravTrack question then answers 403 `TRAVTRACK_DISABLED` and leaves it.
 */
const router = Router();
router.use(authenticate, requireWriteScope);

const user = (req: AuthRequest) => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

export const LIST_STATUSES = ["pending", "accepted", "rejected", "invalidated"] as const;
const listQuery = z.object({ status: z.enum(LIST_STATUSES).default("pending") }).strict();
export const acceptBodySchema = z.object({ verdict: z.enum(["visited", "ground"]) }).strict();
const idParam = z.object({ id: z.string().uuid() });

const envelopes = (rows: Parameters<typeof toEnvelope>[0][]): EvidenceSuggested[] =>
  rows.map(toEnvelope).filter((e): e is EvidenceSuggested => e !== null);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { status } = listQuery.parse(req.query);
    // An accept in progress is still an open question to the inbox.
    const rows = await prisma.locationSuggestion.findMany({
      where: { userId, status: status === "pending" ? { in: ["pending", "accepting"] } : status },
      orderBy: [{ windowFrom: "asc" }, { id: "asc" }],
      take: 200,
      select: SUGGESTION_SELECT,
    });
    res.json({ success: true, data: envelopes(rows) });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/accept", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { id } = idParam.parse(req.params);
    const { verdict } = acceptBodySchema.parse(req.body ?? {});
    const row = await acceptCountrySuggestion(userId, id, verdict);
    res.json({ success: true, data: envelopes([row])[0] ?? null });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/reject", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { id } = idParam.parse(req.params);
    const row = await rejectSuggestion(userId, id);
    res.json({ success: true, data: envelopes([row])[0] ?? null });
  } catch (e) {
    next(e);
  }
});

export default router;
