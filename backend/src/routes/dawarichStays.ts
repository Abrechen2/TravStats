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
    } catch {
      /* connection unavailable, no secret returned */
    }
    res.json({
      success: true,
      data: {
        ...withScanTimes(state),
        enabled: state?.enabled ?? false,
        connected,
        result:
          state?.result === "running" && state.leaseUntil && state.leaseUntil < new Date()
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
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    if (enabled) await ownConnection(userId);
    const state = await prisma.dawarichStayScan.upsert({
      where: { userId },
      create: { userId, enabled },
      update: { enabled },
    });
    res.json({ success: true, data: withScanTimes(state) });
  } catch (e) {
    next(e);
  }
});
router.post("/scan", rejectDemo, scanLimiter, async (req: AuthRequest, res, next) => {
  try {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const userId = user(req);
    await reserveScan(userId);
    const job = startJob("dawarichStays.scan", userId, () => scanStays(userId));
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
router.get("/choices", async (req: AuthRequest, res, next) => {
  try {
    const userId = user(req);
    const [places, trips] = await Promise.all([
      prisma.place.findMany({
        where: { userId },
        select: { id: true, name: true, lat: true, lon: true },
        orderBy: { name: "asc" },
      }),
      prisma.trip.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { startDate: "desc" },
      }),
    ]);
    res.json({ success: true, data: { places, trips } });
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
