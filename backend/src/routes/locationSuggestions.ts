import { Router } from "express";

import { z } from "../schemas/zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { toEnvelope } from "../services/locationEvidence/envelope";
import {
  loadSuggestion,
  rejectSuggestion,
  SUGGESTION_SELECT,
  type StoredSuggestion,
} from "../services/locationEvidence/suggestionStore";
import { acceptCountrySuggestion } from "../services/locationEvidence/countryAccept";
import { acceptJourneyRun, closeJourneyRuns } from "../services/locationEvidence/journeys/accept";
import {
  JOURNEY_ENTRY_KINDS,
  parseJourneyEvidence,
  publicJourney,
  type PublicJourney,
} from "../services/locationEvidence/journeys/evidence";
import type { EvidenceSuggested } from "../services/locationEvidence/types";

/**
 * What location history asks the user (TravTrack plan E6/E7):
 * `/api/v1/location-suggestions`, enveloped like `dawarichStays.ts`. Rows go
 * out as `EvidenceSuggested`; a journey question adds its runs (times,
 * distance, ends, the speed hint and each run's answer) for the owner's inbox
 * — never a digest, a line or the evidence key.
 *
 * The body follows the question's kind: a country is answered with
 * `{ verdict }`, a journey run with `{ runIndex, entryKind, entryId }`; a
 * journey run (or all open ones) is closed with `{ runIndex? }`. Both go
 * through the one accept protocol (`acceptFlow.ts`).
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
export const journeyAcceptSchema = z
  .object({
    runIndex: z.number().int().min(0).max(1_000),
    entryKind: z.enum(JOURNEY_ENTRY_KINDS),
    entryId: z.string().min(1).max(64),
  })
  .strict();
export const journeyCloseSchema = z
  .object({ runIndex: z.number().int().min(0).max(1_000).optional() })
  .strict();

type Answer = EvidenceSuggested & { journey?: PublicJourney };

function answer(row: StoredSuggestion): Answer | null {
  const envelope = toEnvelope(row);
  if (!envelope) return null;
  const journey = row.kind === "journey" ? parseJourneyEvidence(row.evidence) : null;
  return journey ? { ...envelope, journey: publicJourney(journey) } : envelope;
}

const answers = (rows: StoredSuggestion[]): Answer[] =>
  rows.map(answer).filter((a): a is Answer => a !== null);

/** A kind this server cannot answer is refused before anything is read from the body. */
const unanswerable = () =>
  new AppError("This question is not answered here", 400, "VALIDATION_FAILED", "id");

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
    res.json({ success: true, data: answers(rows) });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/accept", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { id } = idParam.parse(req.params);
    const { kind } = await loadSuggestion(userId, id);
    let row: StoredSuggestion;
    if (kind === "country") {
      const { verdict } = acceptBodySchema.parse(req.body ?? {});
      row = await acceptCountrySuggestion(userId, id, verdict);
    } else if (kind === "journey") {
      row = await acceptJourneyRun(userId, id, journeyAcceptSchema.parse(req.body ?? {}));
    } else throw unanswerable();
    res.json({ success: true, data: answer(row) });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/reject", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { id } = idParam.parse(req.params);
    const { kind } = await loadSuggestion(userId, id);
    let row: StoredSuggestion;
    if (kind === "country") {
      row = await rejectSuggestion(userId, id);
    } else if (kind === "journey") {
      const { runIndex } = journeyCloseSchema.parse(req.body ?? {});
      row = await closeJourneyRuns(userId, id, runIndex);
    } else throw unanswerable();
    res.json({ success: true, data: answer(row) });
  } catch (e) {
    next(e);
  }
});

export default router;
