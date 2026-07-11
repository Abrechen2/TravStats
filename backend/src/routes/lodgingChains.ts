import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";

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
