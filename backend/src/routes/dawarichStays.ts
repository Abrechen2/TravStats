import { Router } from "express";
import { z } from "../schemas/zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { userOrIpKey, patAwareMax } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { ownConnection, reserveScan, scanStays } from "../services/dawarich/stays/scan";
import { acceptStay, rejectStay } from "../services/dawarich/stays/review";
import { stayReviewSchema } from "../schemas/dawarichStays";
import { withStayTimes, withScanTimes } from "../services/dawarich/stays/times";
import { startJob } from "../services/jobs/jobRegistry";

import {
  placesEnabled,
  requirePlacesEnabled,
  nextStayScanAt,
} from "../services/dawarich/stays/availability";

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
router.get("/settings", async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const state = await prisma.dawarichStayScan.findUnique({ where: { userId } });
    let connected = false;
    try {
      await ownConnection(userId);
      connected = true;
    } catch (error) {
      // Only "no own connection" means disconnected. A database error used to
      // land here too and was shown as a missing connection.
      if (!(error instanceof AppError && error.code === "DAWARICH_OWN_CONNECTION_REQUIRED"))
        throw error;
    }
    const places = await placesEnabled(userId);
    const pausedReason = !state?.enabled
      ? "disabled"
      : !places
        ? "placesDisabled"
        : !connected
          ? "connectionMissing"
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
        marketEnabled: state?.marketEnabled ?? false,
        venueEnabled: state?.venueEnabled ?? false,
        marketResult: state?.marketResult ?? null,
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
      await ownConnection(userId);
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
      update: { ...patch, leaseUntil: null },
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
    const { status } = z
      .object({ status: z.enum(["pending", "accepted", "rejected"]).default("pending") })
      .parse(req.query);
    const rows = await prisma.dawarichStay.findMany({
      where: { userId, status },
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
router.post("/:id/accept", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
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
    await rejectStay(user(req), z.string().uuid().parse(req.params.id));
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
export default router;
