import { Router, Response, NextFunction } from "express";

import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { statsLimiter } from "../middleware/rateLimit";
import { Prisma } from "../prisma";
import {
  createLoyaltyMembershipSchema,
  foreignCoverage,
  updateLoyaltyMembershipSchema,
  type TierPeriodInput,
} from "../schemas/loyalty";
import { type LoyaltyDomain } from "../shared/domains";
import { loadFrequentFlyerSuggestions } from "../services/loyalty/frequentFlyerSuggestions";
import { loadMembershipActivity } from "../services/loyalty/membershipActivity";
import logger from "../utils/logger";

/**
 * Every loyalty card of the user's, across domains — the loyalty page
 * (owner, 2026-09-25). Enveloped, like the lodging router it grew out of.
 *
 * `routes/lodgingMemberships.ts` keeps serving the hotel cards to the stay
 * editor and the chain page; both routers write the same rows, so a card
 * created on either surface appears on the other.
 *
 * No rate limiter on the writes: a person holds a handful of cards. The two
 * reads derive from the logbook — every flight, cruise and stay once per
 * request, the order of work of a statistics tab — so they share the
 * statistics limiter.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const INCLUDE = {
  chains: { include: { chain: { select: { id: true, name: true } } } },
  lodgings: { include: { lodging: { select: { id: true, name: true } } } },
  tierPeriods: { orderBy: [{ validFrom: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.LoyaltyMembershipInclude;

type CardRow = Prisma.LoyaltyMembershipGetPayload<{ include: typeof INCLUDE }>;

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function serialize(card: CardRow) {
  const { chains, lodgings, tierPeriods, ...rest } = card;
  return {
    ...rest,
    chainIds: chains.map((link) => link.chainId),
    chains: chains.map((link) => link.chain),
    lodgingIds: lodgings.map((link) => link.lodgingId),
    lodgings: lodgings.map((link) => link.lodging),
    tierPeriods: tierPeriods.map((p) => ({
      id: p.id,
      tier: p.tier,
      validFrom: day(p.validFrom),
      validUntil: day(p.validUntil),
    })),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const DUPLICATE = "A membership for this programme already exists in this domain";

async function resolveChainIds(chainIds: number[]): Promise<number[]> {
  const unique = Array.from(new Set(chainIds));
  if (unique.length === 0) return [];
  const found = await prisma.lodgingChain.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) throw new AppError("Unknown chain id(s)", 400);
  return unique;
}

/** Scoped to the caller: another user's hotel is "unknown", like one that never existed. */
async function resolveLodgingIds(lodgingIds: string[], userId: string): Promise<string[]> {
  const unique = Array.from(new Set(lodgingIds));
  if (unique.length === 0) return [];
  const found = await prisma.lodging.findMany({
    where: { id: { in: unique }, userId },
    select: { id: true },
  });
  if (found.length !== unique.length) throw new AppError("Unknown lodging id(s)", 400);
  return unique;
}

/** Same text twice is one entry — "AIDA Cruises" and "aida cruises " cover the same line. */
function dedupeText(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, v.trim());
  }
  return [...seen.values()];
}

const periodRows = (periods: TierPeriodInput[]) =>
  periods.map((p) => ({
    tier: p.tier,
    validFrom: new Date(`${p.validFrom}T00:00:00Z`),
    validUntil: p.validUntil ? new Date(`${p.validUntil}T00:00:00Z`) : null,
  }));

router.get("/", statsLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const cards = await prisma.loyaltyMembership.findMany({
      where: { userId },
      orderBy: [{ domain: "asc" }, { programName: "asc" }],
      include: INCLUDE,
    });
    const activity = await loadMembershipActivity(userId, cards);
    res.json({
      success: true,
      data: cards.map((card) => ({
        ...serialize(card),
        activity: activity.get(card.id) ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/suggestions",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      res.json({ success: true, data: await loadFrequentFlyerSuggestions(userId) });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createLoyaltyMembershipSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const { chainIds, lodgingIds, tierPeriods, airlineCodes, cruiseLines, ...fields } = parsed.data;
    const chainLinks = await resolveChainIds(chainIds ?? []);
    const lodgingLinks = await resolveLodgingIds(lodgingIds ?? [], userId);

    try {
      const card = await prisma.loyaltyMembership.create({
        data: {
          ...fields,
          userId,
          airlineCodes: Array.from(new Set(airlineCodes ?? [])),
          cruiseLines: dedupeText(cruiseLines ?? []),
          chains: { create: chainLinks.map((chainId) => ({ chainId })) },
          lodgings: { create: lodgingLinks.map((lodgingId) => ({ lodgingId })) },
          tierPeriods: { create: periodRows(tierPeriods ?? []) },
        },
        include: INCLUDE,
      });
      logger.info({ operation: "loyalty_membership_create", domain: card.domain, userId });
      res.status(201).json({ success: true, data: serialize(card) });
    } catch (createError) {
      if (!isUniqueConstraintError(createError)) throw createError;
      throw new AppError(DUPLICATE, 409);
    }
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    // Ownership inside the query: another user's id and a missing one are the
    // same 404, so the answer never confirms that a row exists.
    const existing = await prisma.loyaltyMembership.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) throw new AppError("Membership not found", 404);

    const parsed = updateLoyaltyMembershipSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const domain = existing.domain as LoyaltyDomain;
    const foreign = foreignCoverage(domain, parsed.data);
    if (foreign.length > 0) {
      throw new AppError(`A ${domain} membership cannot carry ${foreign.join(", ")}`, 400);
    }

    const { chainIds, lodgingIds, tierPeriods, airlineCodes, cruiseLines, ...fields } = parsed.data;
    // Absent leaves a list alone, an array replaces it — editing a tier can
    // never unlink a chain or wipe the status history as a side effect.
    const chainLinks = chainIds === undefined ? null : await resolveChainIds(chainIds);
    const lodgingLinks =
      lodgingIds === undefined ? null : await resolveLodgingIds(lodgingIds, userId);

    try {
      const card = await prisma.$transaction(async (tx) => {
        await tx.loyaltyMembership.update({
          where: { id: existing.id },
          data: {
            ...fields,
            ...(airlineCodes !== undefined && {
              airlineCodes: Array.from(new Set(airlineCodes)),
            }),
            ...(cruiseLines !== undefined && { cruiseLines: dedupeText(cruiseLines) }),
            // Touched explicitly so a history-only edit still moves the
            // statistics fingerprint (`middleware/statsEtag.ts`).
            updatedAt: new Date(),
          },
        });
        if (chainLinks !== null) {
          await tx.lodgingMembershipChain.deleteMany({ where: { membershipId: existing.id } });
          await tx.lodgingMembershipChain.createMany({
            data: chainLinks.map((chainId) => ({ membershipId: existing.id, chainId })),
          });
        }
        if (lodgingLinks !== null) {
          await tx.lodgingMembershipLodging.deleteMany({ where: { membershipId: existing.id } });
          await tx.lodgingMembershipLodging.createMany({
            data: lodgingLinks.map((lodgingId) => ({ membershipId: existing.id, lodgingId })),
          });
        }
        if (tierPeriods !== undefined) {
          await tx.loyaltyTierPeriod.deleteMany({ where: { membershipId: existing.id } });
          await tx.loyaltyTierPeriod.createMany({
            data: periodRows(tierPeriods).map((p) => ({ ...p, membershipId: existing.id })),
          });
        }
        return tx.loyaltyMembership.findUniqueOrThrow({
          where: { id: existing.id },
          include: INCLUDE,
        });
      });
      res.json({ success: true, data: serialize(card) });
    } catch (updateError) {
      if (!isUniqueConstraintError(updateError)) throw updateError;
      throw new AppError(DUPLICATE, 409);
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.loyaltyMembership.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) throw new AppError("Membership not found", 404);
    // Stays that named this card fall back to derivation (FK SET NULL); its
    // links and status history cascade with it.
    await prisma.loyaltyMembership.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
