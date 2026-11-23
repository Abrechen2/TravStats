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
import { acceptTripSuggestion, tripAcceptSchema } from "../services/locationEvidence/trips/accept";
import { publicTrip, tripIdOf, type PublicTrip } from "../services/locationEvidence/trips/evidence";
import type { EvidenceSuggested } from "../services/locationEvidence/types";
import { tripSuggestionsEnabled } from "../services/settings/suggestionSwitches";
import { openTripCards } from "../services/tripSuggestions/stream";
import { recordTravTrackTripDecision } from "../services/tripSuggestions/travTrackDecision";

/**
 * What location history asks the user (TravTrack plan E6/E7/L4):
 * `/api/v1/location-suggestions`, enveloped like `dawarichStays.ts`. Rows go
 * out as `EvidenceSuggested`; a journey question adds its runs (times,
 * distance, ends, the speed hint and each run's answer) for the owner's inbox
 * — never a digest, a line or the evidence key. A trip question adds its
 * span, countries and distance from home, and the name of the trip it would
 * widen — days, countries, km, no map (L4).
 *
 * The body follows the question's kind: a country is answered with
 * `{ verdict }`, a journey run with `{ runIndex, entryKind, entryId }`; a
 * journey run (or all open ones) is closed with `{ runIndex? }`; a trip is
 * answered with `{ action: "create", name }` or `{ action: "extend", tripId }`
 * and rejected with an empty body. All go
 * through the one accept protocol (`acceptFlow.ts`).
 *
 * Listing and rejecting work with TravTrack switched off; accepting a
 * TravTrack question then answers 403 `TRAVTRACK_DISABLED` and leaves it.
 *
 * Trip questions follow the account's trip-suggestion switch and the merged
 * stream (trip suggestions v2, `services/tripSuggestions/stream.ts`): the
 * pending list carries only the trip rows the stream keeps open — none while
 * switched off (they stay stored, hidden) — and answering one is refused with
 * 409 `TRIP_SUGGESTIONS_DISABLED` while off. Every answer is also written to
 * the shared decision table, so the engine never re-asks the same days.
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

type Answer = EvidenceSuggested & { journey?: PublicJourney; trip?: PublicTrip };

function answerWith(row: StoredSuggestion, names: ReadonlyMap<string, string>): Answer | null {
  const envelope = toEnvelope(row);
  if (!envelope) return null;
  if (row.kind === "trip") {
    const trip = publicTrip(row.evidence, names);
    return trip ? { ...envelope, trip } : envelope;
  }
  const journey = row.kind === "journey" ? parseJourneyEvidence(row.evidence) : null;
  return journey ? { ...envelope, journey: publicJourney(journey) } : envelope;
}

/** The names of the trips the account's trip questions would widen. */
async function tripNames(userId: string, rows: StoredSuggestion[]) {
  const ids = [...new Set(rows.map((r) => (r.kind === "trip" ? tripIdOf(r.evidence) : null)))];
  const wanted = ids.filter((id): id is string => id !== null);
  if (wanted.length === 0) return new Map<string, string>();
  const trips = await prisma.trip.findMany({
    where: { userId, id: { in: wanted } },
    select: { id: true, name: true },
  });
  return new Map(trips.map((t) => [t.id, t.name]));
}

async function answers(userId: string, rows: StoredSuggestion[]): Promise<Answer[]> {
  const names = await tripNames(userId, rows);
  return rows.map((r) => answerWith(r, names)).filter((a): a is Answer => a !== null);
}

const answer = async (userId: string, row: StoredSuggestion) =>
  (await answers(userId, [row]))[0] ?? null;

/** A kind this server cannot answer is refused before anything is read from the body. */
const unanswerable = () =>
  new AppError("This question is not answered here", 400, "VALIDATION_FAILED", "id");

/** A trip question is answered only while the account's trip suggestions are on. */
async function refuseWhileOff(userId: string): Promise<void> {
  if (!(await tripSuggestionsEnabled(userId)))
    throw new AppError("Trip suggestions are switched off", 409, "TRIP_SUGGESTIONS_DISABLED");
}

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { status } = listQuery.parse(req.query);
    // An accept in progress is still an open question to the inbox.
    const pending = status === "pending";
    // Pending trip rows are only those the merged stream keeps open (null: off).
    const stream = pending ? await openTripCards(userId) : null;
    const tripIds = [...(stream?.travTrackIds ?? [])];
    const rows = await prisma.locationSuggestion.findMany({
      where: {
        userId,
        status: pending ? { in: ["pending", "accepting"] } : status,
        ...(pending ? { OR: [{ kind: { not: "trip" } }, { id: { in: tripIds } }] } : {}),
      },
      orderBy: [{ windowFrom: "asc" }, { id: "asc" }],
      take: 200,
      select: SUGGESTION_SELECT,
    });
    res.json({ success: true, data: await answers(userId, rows) });
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
    } else if (kind === "trip") {
      await refuseWhileOff(userId);
      row = await acceptTripSuggestion(userId, id, tripAcceptSchema.parse(req.body ?? {}));
      if (row.status === "accepted") await recordTravTrackTripDecision(userId, id, "accepted");
    } else throw unanswerable();
    res.json({ success: true, data: await answer(userId, row) });
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
    if (kind === "trip") {
      await refuseWhileOff(userId);
      row = await rejectSuggestion(userId, id);
      await recordTravTrackTripDecision(userId, id, "dismissed");
    } else if (kind === "country") {
      row = await rejectSuggestion(userId, id);
    } else if (kind === "journey") {
      const { runIndex } = journeyCloseSchema.parse(req.body ?? {});
      row = await closeJourneyRuns(userId, id, runIndex);
    } else throw unanswerable();
    res.json({ success: true, data: await answer(userId, row) });
  } catch (e) {
    next(e);
  }
});

export default router;
