import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { createMembershipSchema, updateMembershipSchema } from "../schemas/lodging";
import logger from "../utils/logger";

// A strictly user-owned resource — a loyalty membership (e.g. "my Marriott
// Bonvoy Gold card"). Unlike LodgingChain, this is never shared: every read
// and write is scoped to the caller.
//
// Memberships are PROGRAM-based, not chain-based (several chains — Sheraton,
// Westin, Ritz-Carlton — share one loyalty program, Marriott Bonvoy), so
// there is intentionally no `chainId` anywhere in this router. See
// `schemas/lodging.ts` and the `LodgingMembership` model in schema.prisma.

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST/PATCH/DELETE — consistent with routes/lodging.ts.
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const memberships = await prisma.lodgingMembership.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: memberships });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createMembershipSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    try {
      const membership = await prisma.lodgingMembership.create({
        data: { ...parsed.data, userId },
      });
      logger.info({
        operation: "lodging_membership_create",
        membershipId: membership.id,
        userId,
      });
      res.status(201).json({ success: true, data: membership });
    } catch (createError) {
      if (!isUniqueConstraintError(createError)) throw createError;
      // `@@unique([userId, programName])` — one membership per program per
      // user. Unlike the shared chain catalog, this is a genuinely per-user
      // conflict: a second "Marriott Bonvoy" card is a mistake (or the user
      // meant to PATCH their existing one), not a missing-catalog-entry
      // situation — so it's a clean 409, never a raw Prisma 500.
      throw new AppError("A membership for this program already exists", 409);
    }
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    // Ownership check lives INSIDE the query — a mismatched id (someone
    // else's row, or one that never existed) returns null either way, so
    // the 404 below never leaks whether the row exists for another user.
    const existing = await prisma.lodgingMembership.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) throw new AppError("Membership not found", 404);

    const parsed = updateMembershipSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    try {
      const membership = await prisma.lodgingMembership.update({
        where: { id: existing.id },
        data: parsed.data,
      });
      res.json({ success: true, data: membership });
    } catch (updateError) {
      if (!isUniqueConstraintError(updateError)) throw updateError;
      throw new AppError("A membership for this program already exists", 409);
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.lodgingMembership.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) throw new AppError("Membership not found", 404);
    // LodgingStay.membershipId -> onDelete: SetNull (schema.prisma) — the DB
    // clears the FK on any stay referencing this membership by itself; the
    // stay row is never touched otherwise, so no manual cleanup is needed
    // here.
    await prisma.lodgingMembership.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
