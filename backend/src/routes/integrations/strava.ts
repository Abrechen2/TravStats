import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { getInstanceSettings } from "../../services/instanceSettingsService";
import {
  deauthorize,
  exchangeCode,
  fetchActivityTrack,
  listActivities,
} from "../../services/strava/stravaClient";
import {
  clearStravaTokens,
  createOAuthState,
  getStravaAccessToken,
  getStravaStatus,
  requireStravaClient,
  saveStravaTokens,
  verifyOAuthState,
} from "../../services/strava/stravaConnection";
import { StravaError, stravaErrorStatus } from "../../services/strava/stravaErrors";
import { activityFromSportType } from "../../services/strava/sportType";
import { ingestTrack } from "../../services/tour/tracks/ingestTrack";
import { ingestedTrackColumns, isDuplicateExternalRef } from "../../services/tour/tracks/trackRow";
import { resolveRoute } from "../trips/tourRoutes";
import { resolveTrip } from "../trips/resolveTrip";
import logger from "../../utils/logger";

/**
 * Strava (2.7, design 2026-09-24 §5).
 *
 * The consent round trip: the browser asks `/authorize` for Strava's URL,
 * goes there, and Strava sends it back to the SPA's own callback page with a
 * `code`. The auth cookie is SameSite=strict, so it is not on that first,
 * cross-site navigation — which is why the callback is a page, not an API
 * route: the page then posts the code to `/exchange`, same-site, with the
 * cookie, and `state` proves the code belongs to this user's own attempt.
 *
 * Strava's terms (Nov 2024): a user's Strava data is shown to that user only
 * and never to an AI model. Imported tracks carry `source = "strava"`.
 *
 * Every Strava failure answers with `{ error, kind }` from the fixed
 * vocabulary in `stravaErrors.ts`.
 */
const router = Router();

const CALLBACK_PATH = "/integrations/strava/callback";
const SCOPE = "activity:read_all";

function sendStravaError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof StravaError) {
    res.status(stravaErrorStatus(error.kind)).json({ error: error.message, kind: error.kind });
    return;
  }
  next(error);
}

/**
 * The redirect target must be this instance's own callback page. Strava only
 * honours the callback domain registered for the operator's app, but checking
 * here as well keeps a crafted request from sending a code anywhere else.
 */
async function assertOwnCallback(redirectUri: string, origin: string | undefined): Promise<void> {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new AppError("redirectUri is not a URL", 400);
  }
  const settings = await getInstanceSettings();
  const allowed = new Set(
    [origin, settings.frontendUrl, settings.publicUrl, settings.lanUrl]
      .filter((v): v is string => Boolean(v))
      .map((v) => {
        try {
          return new URL(v).origin;
        } catch {
          return null;
        }
      })
      .filter((v): v is string => v !== null)
  );
  if (url.pathname !== CALLBACK_PATH || !allowed.has(url.origin)) {
    throw new AppError("redirectUri must be this instance's Strava callback page", 400);
  }
}

router.get(
  "/integrations/strava/status",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await getStravaStatus(req.userId!));
    } catch (error) {
      next(error);
    }
  }
);

const authorizeSchema = z.object({ redirectUri: z.string().url().max(500) });

router.post(
  "/integrations/strava/authorize",
  authenticate,
  requireWriteScope,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { redirectUri } = authorizeSchema.parse(req.body);
      await assertOwnCallback(redirectUri, req.get("origin"));
      const client = await requireStravaClient();
      const params = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirectUri,
        response_type: "code",
        approval_prompt: "auto",
        scope: SCOPE,
        state: createOAuthState(req.userId!),
      });
      res.json({ url: `https://www.strava.com/oauth/authorize?${params}` });
    } catch (error) {
      sendStravaError(error, res, next);
    }
  }
);

const exchangeSchema = z.object({
  code: z.string().min(1).max(200),
  state: z.string().min(1).max(500),
  /** Strava lists what the user actually granted; a narrowed consent is refused. */
  scope: z.string().max(200).optional(),
});

router.post(
  "/integrations/strava/exchange",
  authenticate,
  requireWriteScope,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = exchangeSchema.parse(req.body);
      if (!verifyOAuthState(body.state, userId)) {
        throw new AppError("This Strava sign-in has expired or belongs to someone else", 400);
      }
      if (body.scope !== undefined && !body.scope.split(",").includes(SCOPE)) {
        throw new StravaError(
          "auth",
          "Reading activities was not allowed on Strava's consent page"
        );
      }
      const tokens = await exchangeCode(await requireStravaClient(), body.code);
      await saveStravaTokens(userId, tokens);
      logger.info({ message: "strava_connected", context: { userId } });
      res.json(await getStravaStatus(userId));
    } catch (error) {
      sendStravaError(error, res, next);
    }
  }
);

router.delete(
  "/integrations/strava",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      try {
        await deauthorize(await getStravaAccessToken(userId));
      } catch {
        // Not connected, or the token is already dead: nothing to revoke.
      }
      await clearStravaTokens(userId);
      logger.info({ message: "strava_disconnected", context: { userId } });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

const windowSchema = z.object({
  after: z.coerce.date().optional(),
  before: z.coerce.date().optional(),
});

router.get(
  "/integrations/strava/activities",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const window = windowSchema.parse(req.query);
      const token = await getStravaAccessToken(req.userId!);
      res.json({ activities: await listActivities(token, window) });
    } catch (error) {
      sendStravaError(error, res, next);
    }
  }
);

const importSchema = z.object({
  activityId: z.string().regex(/^\d{1,20}$/),
  tripId: z.string().uuid().nullish(),
});

type FetchedActivity = Awaited<ReturnType<typeof fetchActivityTrack>>;

/** Stores one fetched Strava activity as a track of `routeId`; 409 when it is already there. */
async function importInto(routeId: string, activityId: string, fetched: FetchedActivity) {
  const ingested = ingestTrack(fetched.track);
  if (!ingested) {
    throw new StravaError("protocol", "This activity cannot be placed in time");
  }
  try {
    const track = await prisma.tripRouteTrack.create({
      data: {
        routeId,
        source: "strava",
        name: fetched.name || null,
        ...ingestedTrackColumns(ingested),
        externalRef: `strava:${activityId}`,
        truncated: false,
      },
      select: { id: true, distanceKm: true, ascentM: true },
    });
    return track;
  } catch (error) {
    if (isDuplicateExternalRef(error)) {
      throw new AppError("This Strava activity has already been imported here", 409);
    }
    throw error;
  }
}

/** Import a Strava activity into an existing tour or roadtrip. */
router.post(
  "/tours/:routeId/tracks/strava",
  authenticate,
  requireWriteScope,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, undefined, req.params.routeId);
      const { activityId } = importSchema.parse(req.body);
      const token = await getStravaAccessToken(userId);
      const track = await importInto(
        routeId,
        activityId,
        await fetchActivityTrack(token, activityId)
      );
      res.status(201).json({ track });
    } catch (error) {
      sendStravaError(error, res, next);
    }
  }
);

/**
 * Make a new day tour from a Strava activity: the activity's name, its sport
 * mapped to an activity, and its recording as the tour's track. The usual
 * way in — someone who tracks with Strava has the tour already, and wants it
 * here, not a blank tour to upload into.
 */
router.post(
  "/tours/import/strava",
  authenticate,
  requireWriteScope,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { activityId, tripId } = importSchema.parse(req.body);
      if (tripId) await resolveTrip(userId, tripId);
      const token = await getStravaAccessToken(userId);
      // Fetch first: a failed Strava call must not leave an empty tour behind.
      const fetched = await fetchActivityTrack(token, activityId);
      const mapped = activityFromSportType(fetched.sportType);
      const route = await prisma.tripRoute.create({
        data: {
          userId,
          tripId: tripId ?? null,
          kind: "tour",
          name: fetched.name || `Strava ${activityId}`,
          mode: mapped.mode,
          activity: mapped.activity,
        },
        select: { id: true },
      });
      try {
        const track = await importInto(route.id, activityId, fetched);
        res.status(201).json({ routeId: route.id, track });
      } catch (error) {
        await prisma.tripRoute.delete({ where: { id: route.id } });
        throw error;
      }
    } catch (error) {
      sendStravaError(error, res, next);
    }
  }
);

export default router;
