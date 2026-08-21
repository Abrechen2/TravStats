import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import {
  LODGING_INCLUDE,
  computeAggregates,
  deriveOverallRating,
  getBaseCurrency,
} from "./lodging";
import { classifyStay } from "../shared/lodgingCounting";

// A shared, global catalog: every authenticated user reads the SAME rows
// (Marriott, Hilton, NH, ...), seeded from CSV in a later task. A user may
// add a chain that's missing from the catalog — that write is then visible
// to everyone, unlike every other resource in the lodging domain, which is
// strictly per-user (see routes/lodging.ts, routes/lodgingMemberships.ts).

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST — consistent with routes/lodging.ts.
router.use(requireWriteScope);

// A huge catalog must never be dumped in one response.
const MAX_CHAINS_PER_REQUEST = 200;

const chainQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
});

// `isUserAdded` and `id` are deliberately absent from this schema: z.object()
// strips unrecognized keys by default, so a client sending either in the
// request body has them dropped before the parsed result ever reaches
// Prisma. The server is the only writer of `isUserAdded` (see below).
const createChainSchema = z.object({
  name: z.string().trim().min(1).max(120),
  loyaltyProgram: z.string().trim().max(120).optional(),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "brandColor must be a 6-digit hex color, e.g. #FF5733")
    .optional(),
});

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const chainIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = chainQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const chains = await prisma.lodgingChain.findMany({
      where: parsed.data.search
        ? { name: { contains: parsed.data.search, mode: "insensitive" } }
        : undefined,
      orderBy: { name: "asc" },
      take: MAX_CHAINS_PER_REQUEST,
    });
    res.json({ success: true, data: chains });
  } catch (err) {
    next(err);
  }
});

// GET /:id — chain detail page (collaborator request: click a chain to see
// every hotel of that chain the CALLER has stayed at, plus their loyalty
// membership for it). Memberships are PROGRAM-based, not chain-based (see
// the module comment on lodgingMemberships.ts), so the membership match here
// is on `chain.loyaltyProgram`, never `chain.id` — there is intentionally no
// `chainId` anywhere on `LodgingMembership`.
router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsedId = chainIdParamSchema.safeParse(req.params);
    if (!parsedId.success) throw new AppError(parsedId.error.message, 400);
    const { id } = parsedId.data;

    const chain = await prisma.lodgingChain.findUnique({ where: { id } });
    if (!chain) throw new AppError("Chain not found", 404);

    // The caller's own lodgings for this chain — same include + aggregate
    // derivation as GET /lodging (routes/lodging.ts), reused rather than
    // re-derived so stayCount/nights/overallRating/totalSpendBase can never
    // drift between the two endpoints.
    const baseCurrency = await getBaseCurrency(userId);
    const rawLodgings = await prisma.lodging.findMany({
      where: { userId, chainId: id },
      include: LODGING_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    const lodgings = rawLodgings.map((l) => ({
      ...l,
      ...computeAggregates(l.stays, baseCurrency),
    }));

    const stats = {
      hotelCount: lodgings.length,
      stayCount: lodgings.reduce((sum, l) => sum + l.stayCount, 0),
      nights: lodgings.reduce((sum, l) => sum + l.nights, 0),
      totalSpendBase: lodgings.reduce((sum, l) => sum + l.totalSpendBase, 0),
      // Averaged across every VISITED stay of every one of the caller's
      // hotels in this chain — NOT an average of the per-hotel averages, so
      // a hotel with 10 rated stays counts 10x more than one with a single
      // stay. Filtered through the same check-out rule as computeAggregates
      // above (shared/lodgingCounting): a scheduled or cancelled stay must
      // not pull this average even if it already carries a rating, or it
      // would disagree with every per-hotel overallRating on this same page.
      avgRating: deriveOverallRating(
        rawLodgings.flatMap((l) => l.stays.filter((s) => classifyStay(s) === "visited")),
      ),
    };

    // The caller's membership for this chain, resolved through the LINK table.
    // It used to be `programName === chain.loyaltyProgram`, a string compare on
    // a marketing name that gets rebranded (NH Rewards -> NH DISCOVERY -> Minor
    // DISCOVERY): correcting either side made the membership vanish from this
    // page, which is why the form had to lock the name. Ids survive renames.
    const link = await prisma.lodgingMembershipChain.findFirst({
      where: { chainId: chain.id, membership: { userId } },
      include: {
        membership: {
          include: { chains: { include: { chain: { select: { id: true, name: true } } } } },
        },
      },
    });
    const membership = link
      ? {
          ...link.membership,
          chainIds: link.membership.chains.map((c) => c.chainId),
          chains: link.membership.chains.map((c) => c.chain),
        }
      : null;

    // What the CATALOGUE suggests this membership should cover — this chain
    // plus every chain seeded with the same programme. A suggestion only: it
    // pre-ticks the boxes when creating a membership and is never consulted
    // again afterwards, so a stale catalogue value costs a checkbox, not a
    // missing membership.
    const suggestedChains = chain.loyaltyProgram
      ? await prisma.lodgingChain.findMany({
          where: { loyaltyProgram: chain.loyaltyProgram },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [{ id: chain.id, name: chain.name }];

    // Which OTHER chains this membership actually covers — from the membership
    // when there is one, from the catalogue suggestion when there is not.
    const siblingChains = (
      membership ? membership.chains : suggestedChains
    ).filter((c) => c.id !== chain.id);

    res.json({
      success: true,
      data: { chain, lodgings, stats, membership, siblingChains, suggestedChains },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createChainSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    // Case-insensitive pre-check: `name`'s @unique constraint is a Postgres
    // unique index, which is case-sensitive, so "hilton" would never collide
    // with "Hilton" at the DB level and would otherwise sail straight into
    // `create` below. Catch that here so the client experience (200 + the
    // existing row) is identical for a case-variant collision as for an
    // exact one. NOT race-safe by itself — see the P2002 catch below for why
    // it's kept as a backstop, and the residual gap that remains.
    const caseInsensitiveMatch = await prisma.lodgingChain.findFirst({
      where: { name: { equals: parsed.data.name, mode: "insensitive" } },
    });
    if (caseInsensitiveMatch) {
      res.status(200).json({ success: true, data: caseInsensitiveMatch });
      return;
    }

    try {
      // isUserAdded is set here, server-side, unconditionally — never from
      // the (already-stripped) parsed input.
      const chain = await prisma.lodgingChain.create({
        data: { ...parsed.data, isUserAdded: true },
      });
      logger.info({ operation: "lodging_chain_create", chainId: chain.id, userId: req.userId });
      res.status(201).json({ success: true, data: chain });
    } catch (createError) {
      if (!isUniqueConstraintError(createError)) throw createError;
      // `name` is @unique. A duplicate name is a completely normal thing for
      // a user to try — they have no visibility into whether the catalog
      // already has the chain they're typing. Decision: treat this as an
      // idempotent "get or add" rather than a hard error — hand back the
      // EXISTING chain with 200, instead of a raw Prisma unique-constraint
      // 500 or an opaque 409 the client would have to special-case. This is
      // the race-safe backstop for the pre-check above: two concurrent
      // requests for the exact same name can both miss the pre-check and
      // race into `create`, but only one wins and the other lands here.
      //
      // Residual gap: this does NOT cover two concurrent requests that
      // differ only in case (e.g. "hilton" and "Hilton" at the same
      // instant) — Postgres's unique index is case-sensitive, so both
      // creates can succeed and neither throws P2002. Closing that fully
      // needs a case-insensitive unique constraint (a `citext` column or a
      // functional `LOWER(name)` index), a schema change deliberately
      // deferred for now.
      const existing = await prisma.lodgingChain.findFirst({
        where: { name: { equals: parsed.data.name, mode: "insensitive" } },
      });
      if (!existing) throw createError; // shouldn't happen — never swallow silently
      res.status(200).json({ success: true, data: existing });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
