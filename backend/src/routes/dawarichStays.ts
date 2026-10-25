import { Router } from "express";
import { z } from "../schemas/zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { userOrIpKey, patAwareMax } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { reserveScan, scanStays } from "../services/dawarich/stays/scan";
import { requireConsentSource, staySourceStatus } from "../services/dawarich/stays/scanSource";
import { acceptStay, rejectStay } from "../services/dawarich/stays/review";
import { resolveCoveredStays } from "../services/dawarich/stays/coverage";
import { stayReviewSchema } from "../schemas/dawarichStays";
import { withStayTimes, withScanTimes } from "../services/dawarich/stays/times";
import { publicMarketCoverage } from "../services/dawarich/stays/publicCoverage";
import { startJob } from "../services/jobs/jobRegistry";
import { stayIdentityFor } from "../services/dawarich/stays/identity";
import { stayPlaceTypeFor } from "../services/dawarich/stays/placeType";

import {
  placesEnabled,
  requirePlacesEnabled,
  requireStaySuggestionsEnabled,
  nextStayScanAt,
} from "../services/dawarich/stays/availability";
import { staySuggestionsEnabled } from "../services/settings/suggestionSwitches";

const router = Router();
router.use(authenticate, requireWriteScope);
const user = (req: AuthRequest) => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};
const scanLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: patAwareMax(6),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});
/**
 * The per-card place identification (forgejo#305) reaches two public geocoders,
 * Immich and possibly a model. The geocoders throttle themselves for the whole
 * process; this caps what one account can ask for in the first place. A card
 * asks once when it comes into view, so 60 a minute is a fast scroll through
 * the inbox, not a script.
 */
const identityLimiter = rateLimit({
  windowMs: 60_000,
  max: patAwareMax(60),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});
router.get("/settings", async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const state = await prisma.dawarichStayScan.findUnique({ where: { userId } });
    // TravTrack accounts read TravTrack (connected while it is on); every
    // other provider the own Dawarich connection, as before.
    const { source, connected } = await staySourceStatus(userId);
    const places = await placesEnabled(userId);
    // The account-wide inbox switch (forgejo#306) outranks the scan's own consent.
    const suggestions = await staySuggestionsEnabled(userId);
    const pausedReason = !suggestions
      ? "suggestionsDisabled"
      : !state?.enabled
        ? "disabled"
        : !places
          ? "placesDisabled"
          : !connected
            ? source === "travtrack"
              ? "travTrackDisabled"
              : "connectionMissing"
            : null;
    res.json({
      success: true,
      data: {
        ...withScanTimes(state),
        placesEnabled: places,
        pausedReason,
        nextScanAt: pausedReason ? null : nextStayScanAt().toISOString(),
        enabled: state?.enabled ?? false,
        connected,
        source,
        marketEnabled: state?.marketEnabled ?? false,
        venueEnabled: state?.venueEnabled ?? false,
        marketResult: publicMarketCoverage(state?.marketResult),
        result:
          state?.result === "running" && pausedReason
            ? "paused"
            : state?.result === "running" && (!state.leaseUntil || state.leaseUntil < new Date())
              ? "interrupted"
              : (state?.result ?? null),
      },
    });
  } catch (e) {
    next(e);
  }
});
router.patch("/settings", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const patch = z
      .object({
        enabled: z.boolean().optional(),
        marketEnabled: z.boolean().optional(),
        venueEnabled: z.boolean().optional(),
      })
      .strict()
      .refine(
        (v) =>
          v.enabled !== undefined || v.marketEnabled !== undefined || v.venueEnabled !== undefined
      )
      .parse(req.body);
    const current = await prisma.dawarichStayScan.findUnique({ where: { userId } });
    const enabled = patch.enabled ?? current?.enabled ?? false;
    if ((patch.marketEnabled || patch.venueEnabled) && !enabled)
      throw new AppError("Enable own stay scan first", 409, "DAWARICH_SCAN_UNAVAILABLE");
    if (enabled && (patch.enabled || patch.marketEnabled || patch.venueEnabled)) {
      await requirePlacesEnabled(userId);
      await requireConsentSource(userId);
    }
    const state = await prisma.dawarichStayScan.upsert({
      where: { userId },
      create: {
        userId,
        enabled,
        marketEnabled: patch.marketEnabled ?? false,
        venueEnabled: patch.venueEnabled ?? false,
      },
      // Invalidate an in-flight reservation across off/on consent changes.
      // Its delayed response may never write under a later consent.
      // Switching the scan off withdraws the map consents too. Left set, a later
      // switch-on resumed Overpass queries the user had not been asked about again.
      update: {
        ...patch,
        ...(patch.enabled === false ? { marketEnabled: false, venueEnabled: false } : {}),
        leaseUntil: null,
      },
    });
    res.json({ success: true, data: withScanTimes(state) });
  } catch (e) {
    next(e);
  }
});
router.post("/scan", rejectDemo, scanLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { lookbackDays } = z
      .object({ lookbackDays: z.number().int().min(1).max(30).default(7) })
      .strict()
      .parse(req.body ?? {});
    const userId = user(req);
    await reserveScan(userId);
    const job = startJob("dawarichStays.scan", userId, () => scanStays(userId, { lookbackDays }));
    res.status(202).json({ success: true, data: { jobId: job.id } });
  } catch (e) {
    next(e);
  }
});
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { status, from, to } = z
      .object({
        status: z.enum(["pending", "accepted", "rejected", "covered"]).default("pending"),
        // A window, so the Companion can ask for one trip's stays (audit
        // 2026-10-23): a stay is in it when the two overlap.
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    // Switched off (forgejo#306): no pending suggestions are offered, and none
    // is resolved either. The rows stay, and come back when it is switched on.
    // Answered rows remain readable — they are history, not suggestions.
    if (status === "pending" && !(await staySuggestionsEnabled(userId))) {
      res.json({ success: true, data: [] });
      return;
    }
    // A visit logged after the last scan (live, on the phone) covers its
    // finding from that moment; the inbox must not offer it until the next scan.
    if (status === "pending") await resolveCoveredStays(userId);
    const rows = await prisma.dawarichStay.findMany({
      where: {
        userId,
        status,
        ...(to ? { startAt: { lte: to } } : {}),
        ...(from ? { endAt: { gte: from } } : {}),
      },
      orderBy: { startAt: "desc" },
      take: 200,
      include: { visit: { select: { id: true, placeId: true } } },
    });
    res.json({ success: true, data: rows.map(withStayTimes) });
  } catch (e) {
    next(e);
  }
});
/**
 * The review form's place and trip pickers. Bounded: an account with thousands
 * of places loaded every one on each inbox open. `q` narrows by name so a place
 * past the cap stays findable, and `truncated` says when the list was cut — a
 * picker that silently shows a subset is a picker that loses the right answer.
 */
const CHOICE_PLACES_CAP = 2000;
const CHOICE_TRIPS_CAP = 500;
const choicesQuery = z.object({ q: z.string().trim().max(200).optional() }).strict();
router.get("/choices", async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const { q } = choicesQuery.parse(req.query);
    const name = q ? { contains: q, mode: "insensitive" as const } : undefined;
    const [places, trips] = await Promise.all([
      prisma.place.findMany({
        where: { userId, ...(name ? { name } : {}) },
        select: { id: true, name: true, lat: true, lon: true },
        // name is not unique; the id keeps the cut at the cap stable.
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: CHOICE_PLACES_CAP + 1,
      }),
      prisma.trip.findMany({
        where: { userId, ...(name ? { name } : {}) },
        select: { id: true, name: true },
        orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        take: CHOICE_TRIPS_CAP + 1,
      }),
    ]);
    res.json({
      success: true,
      data: {
        places: places.slice(0, CHOICE_PLACES_CAP),
        trips: trips.slice(0, CHOICE_TRIPS_CAP),
        truncated: {
          places: places.length > CHOICE_PLACES_CAP,
          trips: trips.length > CHOICE_TRIPS_CAP,
        },
      },
    });
  } catch (e) {
    next(e);
  }
});
router.get("/:id/identity", identityLimiter, async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const id = z.string().uuid().parse(req.params.id);
    // Off means no geocoder, Immich or model request on the stay's behalf.
    await requireStaySuggestionsEnabled(userId);
    res.json({ success: true, data: await stayIdentityFor(userId, id) });
  } catch (e) {
    next(e);
  }
});
router.get("/:id/place-type", identityLimiter, async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const id = z.string().uuid().parse(req.params.id);
    await requireStaySuggestionsEnabled(userId);
    res.json({ success: true, data: await stayPlaceTypeFor(userId, id) });
  } catch (e) {
    next(e);
  }
});
router.post("/:id/accept", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    // Accepting completes an address from the geocoder — an outbound call the
    // switched-off feature must not make.
    await requireStaySuggestionsEnabled(user(req));
    const row = await acceptStay(user(req), id, stayReviewSchema.parse(req.body));
    res.json({ success: true, data: withStayTimes(row) });
  } catch (e) {
    next(e);
  }
});
router.post("/:id/reject", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    await requireStaySuggestionsEnabled(user(req));
    await rejectStay(user(req), z.string().uuid().parse(req.params.id));
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
export default router;
