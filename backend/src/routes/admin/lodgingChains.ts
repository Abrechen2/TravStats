/**
 * Admin › Unterkünfte › Hotelketten (forgejo#321): the lodging-chain
 * CATALOGUE — the owner-less rows every account reads (`userId` null, unique
 * by name among themselves: the partial index in schema.prisma). A user's own
 * chains are theirs and are neither listed nor touched here.
 *
 * Until now the catalogue grew from the CSV seed only and nothing could
 * correct it. What this adds, and the one rule each write keeps:
 *
 *  - add / edit / rename — a name already in the catalogue, in any case, is
 *    refused (`chainNameTaken`), because lookups match names case-insensitively;
 *  - merge — every hotel and every loyalty card linked to the source moves to
 *    the target in ONE transaction, then the source goes. Nobody's link is
 *    dropped: a card linked to both keeps its one target link;
 *  - delete — only a chain nothing links to. One with hotels or cards answers
 *    `chainInUse`; the admin merges it instead. `onDelete: SetNull` would
 *    otherwise unlink every account's hotels silently.
 *
 * A name that leaves the catalogue (renamed, merged away, deleted) is retired,
 * so the boot-time CSV seed does not bring it back as an empty duplicate.
 *
 * Behind `authenticate` + `requireAdmin` + `requireWriteScope` (the admin
 * index). Bare response family. Failures carry a code in `error`.
 */
import { Router, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { userOrIpKey } from "../../middleware/rateLimit";
import logger from "../../utils/logger";

const router = Router();

/**
 * Writes rewrite every account's links in one go; a person curating the list
 * does a few a minute. The read is a typeahead, so it gets more room.
 */
const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});
const readLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});

const MAX_PAGE = 200;

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  take: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
});

const brandColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/);

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    loyaltyProgram: z.string().trim().max(120).nullable().optional(),
    brandColor: brandColor.nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    loyaltyProgram: z.string().trim().max(120).nullable().optional(),
    brandColor: brandColor.nullable().optional(),
  })
  .strict();

const idParams = z.object({ id: z.coerce.number().int().positive() });
const mergeSchema = z.object({ targetId: z.number().int().positive() }).strict();

const CATALOGUE = { userId: null } as const;

const withCounts = {
  _count: { select: { lodgings: true, memberships: true } },
} as const;

type ChainWithCounts = Prisma.LodgingChainGetPayload<{ include: typeof withCounts }>;

function view(chain: ChainWithCounts): Record<string, unknown> {
  const { _count, userId: _userId, ...rest } = chain;
  return { ...rest, lodgingCount: _count.lodgings, membershipCount: _count.memberships };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError("invalidInput", 400);
  return parsed.data;
}

async function catalogueChain(tx: DbTransaction, id: number): Promise<ChainWithCounts> {
  const chain = await tx.lodgingChain.findFirst({
    where: { id, ...CATALOGUE },
    include: withCounts,
  });
  if (!chain) throw new AppError("chainNotFound", 404);
  return chain;
}

/** Another catalogue row answers to this name, in any case. */
async function assertNameFree(tx: DbTransaction, name: string, exceptId?: number): Promise<void> {
  const clash = await tx.lodgingChain.findFirst({
    where: {
      ...CATALOGUE,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new AppError("chainNameTaken", 409);
}

/**
 * Lock the chain row for the rest of the transaction. Linking a hotel or a
 * card to a chain takes a key-share lock on that row (the foreign key), which
 * this blocks: no link can appear between our count and our delete — a write
 * racing us waits, then fails on the missing row instead of being set to
 * null without anyone knowing.
 */
async function lockChain(tx: DbTransaction, id: number): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM lodging_chains WHERE id = ${id} FOR UPDATE`;
}

async function retire(tx: DbTransaction, name: string): Promise<void> {
  const key = name.trim().toLowerCase();
  await tx.retiredLodgingChainName.upsert({
    where: { name: key },
    update: {},
    create: { name: key },
  });
}

async function unretire(tx: DbTransaction, name: string): Promise<void> {
  await tx.retiredLodgingChainName.deleteMany({ where: { name: name.trim().toLowerCase() } });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

router.get(
  "/lodging-chains",
  readLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { search, take } = parse(listQuerySchema, req.query);
      const where: Prisma.LodgingChainWhereInput = {
        ...CATALOGUE,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      };
      const [total, items] = await Promise.all([
        prisma.lodgingChain.count({ where }),
        prisma.lodgingChain.findMany({
          where,
          include: withCounts,
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: take ?? MAX_PAGE,
        }),
      ]);
      res.json({ items: items.map(view), total });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/lodging-chains",
  writeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = parse(createSchema, req.body);
      const chain = await prisma.$transaction(async (tx) => {
        await assertNameFree(tx, body.name);
        await unretire(tx, body.name);
        return tx.lodgingChain.create({
          data: {
            name: body.name,
            loyaltyProgram: body.loyaltyProgram ?? null,
            brandColor: body.brandColor ?? null,
            // An admin's addition is not seed data: the seed must never claim it.
            isUserAdded: true,
          },
          include: withCounts,
        });
      });
      logger.info({ operation: "admin_lodging_chain_create", chainId: chain.id, by: req.userId });
      res.status(201).json(view(chain));
    } catch (error) {
      next(isUniqueViolation(error) ? new AppError("chainNameTaken", 409) : error);
    }
  }
);

router.patch(
  "/lodging-chains/:id",
  writeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = parse(idParams, req.params);
      const body = parse(updateSchema, req.body);
      const chain = await prisma.$transaction(async (tx) => {
        const current = await catalogueChain(tx, id);
        const renamed = body.name !== undefined && body.name !== current.name;
        if (renamed) {
          await assertNameFree(tx, body.name!, id);
          if (body.name!.toLowerCase() !== current.name.toLowerCase())
            await retire(tx, current.name);
          await unretire(tx, body.name!);
        }
        return tx.lodgingChain.update({
          where: { id },
          data: {
            ...(renamed ? { name: body.name } : {}),
            ...(body.loyaltyProgram !== undefined ? { loyaltyProgram: body.loyaltyProgram } : {}),
            ...(body.brandColor !== undefined ? { brandColor: body.brandColor } : {}),
          },
          include: withCounts,
        });
      });
      logger.info({ operation: "admin_lodging_chain_update", chainId: id, by: req.userId });
      res.json(view(chain));
    } catch (error) {
      next(isUniqueViolation(error) ? new AppError("chainNameTaken", 409) : error);
    }
  }
);

/**
 * Merge `:id` INTO `targetId`. Moves first, deletes last, all in one
 * transaction: a failure anywhere leaves both chains exactly as they were.
 */
router.post(
  "/lodging-chains/:id/merge",
  writeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = parse(idParams, req.params);
      const { targetId } = parse(mergeSchema, req.body);
      if (targetId === id) throw new AppError("mergeIntoItself", 400);

      const result = await prisma.$transaction(async (tx) => {
        await lockChain(tx, id);
        const source = await catalogueChain(tx, id);
        await catalogueChain(tx, targetId);

        // share-exempt: a catalogue chain id is the same for every account and its shared copies
        const lodgings = await tx.lodging.updateMany({
          where: { chainId: id },
          data: { chainId: targetId },
        });

        // A card that covered the source covers the target; one that already
        // covered both keeps its single target link (the pair is the key).
        const links = await tx.lodgingMembershipChain.findMany({
          where: { chainId: id },
          select: { membershipId: true },
        });
        const added = await tx.lodgingMembershipChain.createMany({
          data: links.map((l) => ({ membershipId: l.membershipId, chainId: targetId })),
          skipDuplicates: true,
        });
        await tx.lodgingMembershipChain.deleteMany({ where: { chainId: id } });

        // Nothing points at the source any more, and the lock keeps it so.
        await tx.lodgingChain.delete({ where: { id } });
        await retire(tx, source.name);

        const target = await catalogueChain(tx, targetId);
        return {
          target: view(target),
          moved: {
            lodgings: lodgings.count,
            memberships: links.length,
            newMembershipLinks: added.count,
          },
        };
      });
      logger.info({
        operation: "admin_lodging_chain_merge",
        sourceId: id,
        targetId,
        moved: result.moved,
        by: req.userId,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/lodging-chains/:id",
  writeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = parse(idParams, req.params);
      await prisma.$transaction(async (tx) => {
        await lockChain(tx, id);
        const chain = await catalogueChain(tx, id);
        if (chain._count.lodgings > 0 || chain._count.memberships > 0) {
          throw new AppError("chainInUse", 409);
        }
        await tx.lodgingChain.delete({ where: { id } });
        await retire(tx, chain.name);
      });
      logger.info({ operation: "admin_lodging_chain_delete", chainId: id, by: req.userId });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
