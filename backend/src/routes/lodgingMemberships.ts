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
// A membership covers SEVERAL chains (Sheraton, Westin, Ritz-Carlton -> Marriott
// Bonvoy), attached as an explicit `chainIds` list. It is deliberately not a
// single `chainId`, and no longer a string match between the chain catalogue's
// `loyaltyProgram` and this row's `programName`: programmes get rebranded, and
// that comparison broke the moment either side was corrected. See
// `LodgingMembershipChain` in schema.prisma.

// No rate limiter: per-user CRUD over the caller's own membership rows and
// their chain links. A person has a handful of loyalty programmes, so the
// working set is a handful of rows; nothing here scans, computes or calls out.
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

// Every membership is returned with its chains flattened to ids + names, so no
// consumer has to know the join table exists.
const MEMBERSHIP_INCLUDE = {
  chains: { include: { chain: { select: { id: true, name: true } } } },
  lodgings: { include: { lodging: { select: { id: true, name: true } } } },
} as const;

type MembershipWithChains = Prisma.LodgingMembershipGetPayload<{
  include: typeof MEMBERSHIP_INCLUDE;
}>;

function serialize(membership: MembershipWithChains) {
  const { chains, lodgings, ...rest } = membership;
  return {
    ...rest,
    chainIds: chains.map((link) => link.chainId),
    chains: chains.map((link) => link.chain),
    lodgingIds: lodgings.map((link) => link.lodgingId),
    lodgings: lodgings.map((link) => link.lodging),
  };
}

/**
 * Rejects a chain id that does not exist BEFORE the write, so a typo comes back
 * as a 400 naming the problem rather than a raw foreign-key 500. Returns the
 * de-duplicated list actually to be linked.
 */
async function resolveChainIds(chainIds: number[]): Promise<number[]> {
  const unique = Array.from(new Set(chainIds));
  if (unique.length === 0) return [];
  const found = await prisma.lodgingChain.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    const known = new Set(found.map((c) => c.id));
    const missing = unique.filter((id) => !known.has(id));
    throw new AppError(`Unknown chain id(s): ${missing.join(", ")}`, 400);
  }
  return unique;
}

/**
 * Unlike chains — a shared catalogue where existence is the only question — a
 * lodging is user-owned, so the lookup is scoped to the caller. An id belonging
 * to someone else comes back as "unknown", identical to one that never existed,
 * which is what keeps this from confirming another user's rows. A foreign key
 * alone would have accepted it.
 */
async function resolveLodgingIds(lodgingIds: string[], userId: string): Promise<string[]> {
  const unique = Array.from(new Set(lodgingIds));
  if (unique.length === 0) return [];
  const found = await prisma.lodging.findMany({
    where: { id: { in: unique }, userId },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    const known = new Set(found.map((l) => l.id));
    const missing = unique.filter((id) => !known.has(id));
    throw new AppError(`Unknown lodging id(s): ${missing.join(", ")}`, 400);
  }
  return unique;
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const memberships = await prisma.lodgingMembership.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: MEMBERSHIP_INCLUDE,
    });
    res.json({ success: true, data: memberships.map(serialize) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createMembershipSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const { chainIds, lodgingIds, ...fields } = parsed.data;
    const linkIds = await resolveChainIds(chainIds ?? []);
    const lodgingLinkIds = await resolveLodgingIds(lodgingIds ?? [], userId);

    try {
      const membership = await prisma.lodgingMembership.create({
        data: {
          ...fields,
          userId,
          chains: { create: linkIds.map((chainId) => ({ chainId })) },
          lodgings: { create: lodgingLinkIds.map((lodgingId) => ({ lodgingId })) },
        },
        include: MEMBERSHIP_INCLUDE,
      });
      logger.info({
        operation: "lodging_membership_create",
        membershipId: membership.id,
        chainCount: linkIds.length,
        userId,
      });
      res.status(201).json({ success: true, data: serialize(membership) });
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

    const { chainIds, lodgingIds, ...fields } = parsed.data;
    // Absent `chainIds`/`lodgingIds` leaves the links untouched; an array
    // REPLACES them (an empty array is a deliberate "covers no chain/hotel"),
    // so editing a tier can never unlink a membership as a side effect.
    const linkIds = chainIds === undefined ? null : await resolveChainIds(chainIds);
    const lodgingLinkIds =
      lodgingIds === undefined ? null : await resolveLodgingIds(lodgingIds, userId);

    try {
      const membership = await prisma.$transaction(async (tx) => {
        await tx.lodgingMembership.update({ where: { id: existing.id }, data: fields });
        if (linkIds !== null) {
          await tx.lodgingMembershipChain.deleteMany({ where: { membershipId: existing.id } });
          if (linkIds.length > 0) {
            await tx.lodgingMembershipChain.createMany({
              data: linkIds.map((chainId) => ({ membershipId: existing.id, chainId })),
            });
          }
        }
        if (lodgingLinkIds !== null) {
          await tx.lodgingMembershipLodging.deleteMany({ where: { membershipId: existing.id } });
          if (lodgingLinkIds.length > 0) {
            await tx.lodgingMembershipLodging.createMany({
              data: lodgingLinkIds.map((lodgingId) => ({ membershipId: existing.id, lodgingId })),
            });
          }
        }
        return tx.lodgingMembership.findUniqueOrThrow({
          where: { id: existing.id },
          include: MEMBERSHIP_INCLUDE,
        });
      });
      res.json({ success: true, data: serialize(membership) });
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
    // here. The chain LINKS cascade away with the row (LodgingMembershipChain
    // -> onDelete: Cascade); the chains themselves are catalogue rows and are
    // never touched.
    await prisma.lodgingMembership.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
