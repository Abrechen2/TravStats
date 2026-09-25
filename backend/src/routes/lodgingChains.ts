import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import {
  LODGING_INCLUDE,
  computeAggregates,
  deriveOverallRating,
  getBaseCurrency,
} from "./lodging";
import { classifyStay } from "../shared/lodgingCounting";
import { findOrCreateOwnChain, visibleChainsWhere } from "../services/lodging/chainScope";

// Two kinds of chain, one table (owner decision 2026-09-25): the seeded
// CATALOGUE every account reads (Marriott, Hilton, NH, ...), and chains a user
// added, which only that user sees. Every read here is catalogue ∪ own, every
// create is an own chain — `services/lodging/chainScope.ts` holds the rule.

// No rate limiter. `GET /:id` is the heaviest thing here and it still only
// aggregates the CALLER's own lodgings for one chain — their row count is the
// ceiling. `POST /` writes one of the caller's own rows: two indexed
// statements, idempotent by name, so
// repeating it produces the same single row rather than accumulating work.
// Neither touches an external service.
const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST — consistent with routes/lodging.ts.
router.use(requireWriteScope);
// The shared demo account does not create chains (independent review,
// 2026-09-17, finding A3). Reads pass through: the typeahead is what a
// visitor came to try.
router.use(rejectDemoWrites);

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

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const chainIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = chainQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const userId = requireUser(req);
    const chains = await prisma.lodgingChain.findMany({
      where: {
        AND: [
          visibleChainsWhere(userId),
          ...(parsed.data.search
            ? [{ name: { contains: parsed.data.search, mode: "insensitive" as const } }]
            : []),
        ],
      },
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

    // Another account's chain is "not found", never "forbidden": the answer
    // must not confirm that it exists.
    const chain = await prisma.lodgingChain.findFirst({
      where: { AND: [visibleChainsWhere(userId), { id }] },
    });
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
        rawLodgings.flatMap((l) => l.stays.filter((s) => classifyStay(s) === "visited"))
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
          where: {
            AND: [visibleChainsWhere(userId), { loyaltyProgram: chain.loyaltyProgram }],
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [{ id: chain.id, name: chain.name }];

    // Which OTHER chains this membership actually covers — from the membership
    // when there is one, from the catalogue suggestion when there is not.
    const siblingChains = (membership ? membership.chains : suggestedChains).filter(
      (c) => c.id !== chain.id
    );

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
    const userId = requireUser(req);
    const parsed = createChainSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    // Idempotent "get or add": a name the caller can already see — in the
    // catalogue or among their own, in any case — hands back that row with
    // 200 rather than an error, because a user typing a chain has no way to
    // know whether it exists. A new name becomes the caller's OWN chain and
    // is visible to nobody else. `isUserAdded` and `userId` are set here,
    // server-side, never from the (already-stripped) input.
    const { name, ...fields } = parsed.data;
    const { chain, created } = await findOrCreateOwnChain(userId, name, fields);
    if (created) {
      logger.info({ operation: "lodging_chain_create", chainId: chain.id, userId });
    }
    res.status(created ? 201 : 200).json({ success: true, data: chain });
  } catch (err) {
    next(err);
  }
});

export default router;
