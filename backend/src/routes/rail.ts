import { Router, Response, NextFunction } from "express";

import { prisma } from "../db";
import { Prisma } from "../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { railCreationLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  createRailJourneySchema,
  railQuerySchema,
  updateRailJourneySchema,
  type RailQueryInput,
  type UpdateRailJourneyInput,
} from "../schemas/rail";
import { mergeRailJourney } from "../services/rail/railJourneyWrite";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";
import { assertReferencesOwned } from "../utils/ownedReferences";
import logger from "../utils/logger";

/**
 * Rail journeys — one row per train ride (spec
 * docs/superpowers/specs/2026-09-25-rail-domain.md). Enveloped family, as ADR
 * 0001 asks of a new domain.
 *
 * The endpoints stay reachable whatever the instance beta switch says; the
 * switch hides the UI, it is not an authorisation boundary.
 */

/** What a journey carries when read — list rows and a single row alike. */
export const RAIL_INCLUDE = {
  trip: { select: { id: true, name: true, color: true } },
} satisfies Prisma.RailJourneyInclude;

const DEFAULT_LIMIT = 100;

const SORT_COLUMN: Record<
  RailQueryInput["sort"],
  keyof Prisma.RailJourneyOrderByWithRelationInput
> = {
  departure: "departureTime",
  distance: "distanceKm",
  created: "createdAt",
};

/** Only the distance can be empty; an unmeasured row sorts last either way. */
function primaryOrder(query: RailQueryInput): Prisma.RailJourneyOrderByWithRelationInput {
  const column = SORT_COLUMN[query.sort];
  return column === "distanceKm"
    ? { distanceKm: { sort: query.order, nulls: "last" } }
    : { [column]: query.order };
}

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only tokens keep read access.
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

function buildWhere(query: RailQueryInput, userId: string): Prisma.RailJourneyWhereInput {
  const statuses = query.status === undefined ? undefined : [query.status].flat();
  const q = query.q;
  return {
    userId,
    ...(statuses && { status: { in: statuses } }),
    ...(query.tripId && { tripId: query.tripId }),
    ...(query.year !== undefined && {
      departureTime: {
        gte: new Date(Date.UTC(query.year, 0, 1)),
        lt: new Date(Date.UTC(query.year + 1, 0, 1)),
      },
    }),
    ...(q && {
      OR: (
        [
          "operator",
          "trainCategory",
          "trainNumber",
          "depStationName",
          "arrStationName",
          "bookingReference",
        ] as const
      ).map((field) => ({ [field]: { contains: q, mode: "insensitive" as const } })),
    }),
  };
}

// One page of the logbook. Every sort key is a column, so the bound goes into
// the query; `id` breaks ties, because neither the departure nor the distance
// is unique and a page boundary on a tie would skip or repeat a row.
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = railQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const query = parsed.data;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const where = buildWhere(query, userId);

    const [total, data] = await Promise.all([
      prisma.railJourney.count({ where }),
      prisma.railJourney.findMany({
        where,
        include: RAIL_INCLUDE,
        orderBy: [primaryOrder(query), { id: query.order }],
        take: limit,
        skip: offset,
      }),
    ]);
    res.json({ success: true, data, meta: { total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const journey = await prisma.railJourney.findFirst({
      where: { id: req.params.id, userId },
      include: RAIL_INCLUDE,
    });
    if (!journey) throw new AppError("Rail journey not found", 404);
    res.json({ success: true, data: journey });
  } catch (err) {
    next(err);
  }
});

/** Everything but the derived columns, companions and FX, which the handlers own. */
function plainColumns(
  input: UpdateRailJourneyInput
): Omit<
  UpdateRailJourneyInput,
  | "departureStation"
  | "arrivalStation"
  | "departureLocal"
  | "arrivalLocal"
  | "distanceKm"
  | "status"
  | "companions"
> {
  const {
    departureStation: _dep,
    arrivalStation: _arr,
    departureLocal: _depLocal,
    arrivalLocal: _arrLocal,
    distanceKm: _distance,
    status: _status,
    companions: _companions,
    ...rest
  } = input;
  return rest;
}

router.post(
  "/",
  railCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const parsed = createRailJourneySchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const input = parsed.data;
      // Prisma proves a trip or booking EXISTS, never whose it is (AUD-038).
      await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });

      const state = mergeRailJourney(null, input);
      const companions = await resolveCompanions(userId, input.companions ?? []);
      const fxColumns = await fxColumnsFor(
        { amount: input.price, currency: input.currency, date: state.departureTime },
        await getBaseCurrency(userId)
      );

      const journey = await prisma.$transaction(async (tx) => {
        const created = await tx.railJourney.create({
          data: {
            ...plainColumns(input),
            ...state,
            ...fxColumns,
            userId,
            companions: companions.map((c) => c.displayName),
          },
        });
        if (companions.length > 0) {
          await tx.railJourneyCompanion.createMany({
            data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({
              ...row,
              railJourneyId: created.id,
            })),
            skipDuplicates: true,
          });
        }
        return tx.railJourney.findUniqueOrThrow({
          where: { id: created.id },
          include: RAIL_INCLUDE,
        });
      });

      logger.info({ operation: "rail_journey_create", railJourneyId: journey.id, userId });
      res.status(201).json({ success: true, data: journey });
    } catch (err) {
      next(err);
    }
  }
);

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.railJourney.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Rail journey not found", 404);

    const parsed = updateRailJourneySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;
    await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });

    // The MERGED state, so a one-field PATCH is checked against the stored
    // rest (an arrival moved behind an untouched departure is refused here).
    const state = mergeRailJourney(existing, input);

    const resolved =
      input.companions === undefined
        ? undefined
        : await resolveCompanions(userId, input.companions);
    // Recomputed only when an input it depends on moved — from the merged
    // state, so a currency-only PATCH still converts the unchanged price.
    const fxInputsChanged =
      input.price !== undefined ||
      input.currency !== undefined ||
      state.departureTime.getTime() !== existing.departureTime.getTime();
    const fxColumns = fxInputsChanged
      ? await fxColumnsFor(
          {
            amount: input.price !== undefined ? input.price : existing.price,
            currency: input.currency ?? existing.currency,
            date: state.departureTime,
          },
          await getBaseCurrency(userId)
        )
      : undefined;

    const journey = await prisma.$transaction(async (tx) => {
      if (resolved !== undefined) {
        await tx.railJourneyCompanion.deleteMany({ where: { railJourneyId: existing.id } });
        if (resolved.length > 0) {
          await tx.railJourneyCompanion.createMany({
            data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
              ...row,
              railJourneyId: existing.id,
            })),
            skipDuplicates: true,
          });
        }
      }
      await tx.railJourney.update({
        where: { id: existing.id },
        data: {
          ...plainColumns(input),
          ...state,
          ...fxColumns,
          ...(resolved !== undefined && { companions: resolved.map((c) => c.displayName) }),
        },
      });
      return tx.railJourney.findUniqueOrThrow({
        where: { id: existing.id },
        include: RAIL_INCLUDE,
      });
    });

    res.json({ success: true, data: journey });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.railJourney.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true },
    });
    if (!existing) throw new AppError("Rail journey not found", 404);
    await prisma.railJourney.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
