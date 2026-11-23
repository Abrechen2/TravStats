import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { statsLimiter } from "../middleware/rateLimit";
import {
  acceptSuggestion,
  dismissSuggestion,
  staleError,
} from "../services/tripSuggestions/accept";
import { computeTripSuggestions } from "../services/tripSuggestions/engine";
import { openTripCards } from "../services/tripSuggestions/stream";
import { resetTripSuggestionRejections } from "../services/tripSuggestions/travTrackDecision";
import { tripSuggestionsEnabled } from "../services/settings/suggestionSwitches";

/**
 * `/api/v1/trip-suggestions` — the "Reise-Vorschläge" tab of the Posteingang.
 *
 * One engine across every domain the reader has (`services/tripSuggestions/`)
 * proposes new trips, entries that belong to an existing trip, trips the
 * entries would stretch, and visits to own places. Nothing here is stored but
 * the user's answer, and nothing is written until they accept.
 *
 * An answer names the proposal by id and is checked against a FRESH computation
 * — the id is a digest of the member set, so a proposal that changed since it
 * was shown is refused with `TRIP_SUGGESTION_STALE` instead of being applied to
 * entries the user never saw. Enveloped, like the photo-journey inbox beside it.
 *
 * The account's `tripSuggestions.enabled` switch (forgejo#306) gates every
 * route here BEFORE the engine runs: off, the list and the badge answer empty
 * and an answer is refused, and the stored decisions wait untouched for the
 * switch to come back on.
 *
 * Trip suggestions v2: the list and the badge read the merged stream
 * (`services/tripSuggestions/stream.ts`) — the engine's proposals and the
 * TravTrack questions, at most three open cards between them. The list carries
 * the engine's share of those cards; `/location-suggestions` the TravTrack
 * share; `/count` both.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const acceptBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    startDay: DAY.optional(),
    endDay: DAY.optional(),
    memberKeys: z.array(z.string().min(1).max(80)).max(2000).optional(),
    visitDay: DAY.optional(),
  })
  .strict();

const idSchema = z.string().min(1).max(200);

async function findProposal(userId: string, rawId: unknown) {
  const id = idSchema.safeParse(rawId);
  if (!id.success) throw new AppError("Invalid suggestion id", 400, "VALIDATION_FAILED");
  if (!(await tripSuggestionsEnabled(userId)))
    throw new AppError("Trip suggestions are switched off", 409, "TRIP_SUGGESTIONS_DISABLED");
  const { suggestions } = await computeTripSuggestions(userId);
  const proposal = suggestions.find((s) => s.id === id.data);
  if (!proposal) throw staleError();
  return proposal;
}

router.get(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await openTripCards(req.userId!);
      if (!result) {
        res.json({
          success: true,
          data: { suggestions: [], total: 0, home: null, truncated: false, disabled: true },
        });
        return;
      }
      res.json({
        success: true,
        data: {
          suggestions: result.engine,
          total: result.total,
          home: result.home,
          truncated: result.truncated,
          disabled: false,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * The inbox badge's number: the open cards of the merged stream, so never more
 * than three and 0 while switched off. Unlimited: the navigation polls it, and
 * a cached answer is a dozen aggregates.
 */
router.get("/count", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await openTripCards(req.userId!);
    const count = result ? result.engine.length + result.travTrackIds.size : 0;
    res.json({ success: true, data: { count } });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/accept",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const edits = acceptBodySchema.parse(req.body ?? {});
      const proposal = await findProposal(req.userId!, req.params.id);
      const result = await acceptSuggestion(req.userId!, proposal, edits);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/dismiss",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const proposal = await findProposal(req.userId!, req.params.id);
      await dismissSuggestion(req.userId!, proposal);
      res.json({ success: true, data: { dismissed: true } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * "Abgelehnte zurücksetzen": the account forgets every dismissed trip
 * suggestion (engine and TravTrack), so each period may be asked again.
 */
router.post(
  "/rejections/reset",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reset = await resetTripSuggestionRejections(req.userId!);
      res.json({ success: true, data: { reset } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
