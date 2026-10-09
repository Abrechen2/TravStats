import { Router, Response, NextFunction } from "express";
import type { z } from "zod";

import { prisma } from "../db";
import { Prisma } from "../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { busCreationLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  busQuerySchema,
  createBusJourneySchema,
  strayBusFoldKey,
  updateBusJourneySchema,
  type BusQueryInput,
  type UpdateBusJourneyInput,
} from "../schemas/bus";
import { mergeBusJourney } from "../services/bus/busJourneyWrite";
import { withBusTimes } from "../services/bus/timesDto";
import { recomputeTripStatus } from "../services/tripStatusService";
import { busYear } from "../shared/busCounting";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";
import { linkDocuments, takeDocumentIds } from "../services/documents/documentService";
import { assertReferencesOwned } from "../utils/ownedReferences";
import logger from "../utils/logger";
import { railListSummary } from "../shared/listSummary";

/**
 * Bus rides — one row per coach ride (spec
 * docs/superpowers/specs/2026-10-07-bus-domain-design.md). Enveloped family, as
 * ADR 0001 asks of a new domain. The endpoints stay reachable whatever the
 * instance beta switch says; the switch hides the UI, it is not a boundary.
 */

export const BUS_INCLUDE = {
  trip: { select: { id: true, name: true, color: true } },
} satisfies Prisma.BusJourneyInclude;

const DEFAULT_LIMIT = 100;

const SORT_COLUMN: Record<BusQueryInput["sort"], keyof Prisma.BusJourneyOrderByWithRelationInput> =
  {
    departure: "departureTime",
    distance: "distanceKm",
    created: "createdAt",
  };

function primaryOrder(query: BusQueryInput): Prisma.BusJourneyOrderByWithRelationInput {
  const column = SORT_COLUMN[query.sort];
  return column === "distanceKm"
    ? { distanceKm: { sort: query.order, nulls: "last" } }
    : { [column]: query.order };
}

/** A ride extends its trip's span; every write re-derives the trip it was in and the trip it is in now. */
async function restatusTrips(...tripIds: Array<string | null | undefined>): Promise<void> {
  for (const id of new Set(tripIds.filter((t): t is string => Boolean(t)))) {
    await recomputeTripStatus(id);
  }
}

function refuseStrayFold(body: unknown): void {
  const key = strayBusFoldKey(body);
  if (key) throw new AppError(`Unknown field ${key}`, 400, "BUS_INVALID_INPUT", key);
}

function invalidInput(error: z.ZodError): AppError {
  const field = error.issues[0]?.path[0];
  return new AppError(
    error.message,
    400,
    "BUS_INVALID_INPUT",
    typeof field === "string" ? field : undefined
  );
}

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const MAX_AHEAD_OF_UTC_MS = 14 * 60 * 60 * 1000;
const MAX_BEHIND_UTC_MS = 12 * 60 * 60 * 1000;

/** The rides that left in `year` on their departure terminal's calendar — `busYear`'s rule, per row. */
async function idsDepartingInYear(userId: string, year: number): Promise<string[]> {
  const candidates = await prisma.busJourney.findMany({
    where: {
      userId,
      departureTime: {
        gte: new Date(Date.UTC(year, 0, 1) - MAX_AHEAD_OF_UTC_MS),
        lt: new Date(Date.UTC(year + 1, 0, 1) + MAX_BEHIND_UTC_MS),
      },
    },
    select: { id: true, departureTime: true, depTimezone: true },
  });
  return candidates
    .filter((r) => busYear({ ...r, arrivalTime: null, arrTimezone: null }) === year)
    .map((r) => r.id);
}

export async function buildBusWhere(
  query: Pick<BusQueryInput, "status" | "q" | "year" | "tripId">,
  userId: string
): Promise<Prisma.BusJourneyWhereInput> {
  const statuses = query.status === undefined ? undefined : [query.status].flat();
  const q = query.q;
  return {
    userId,
    ...(statuses && { status: { in: statuses } }),
    ...(query.tripId && { tripId: query.tripId }),
    ...(query.year !== undefined && { id: { in: await idsDepartingInYear(userId, query.year) } }),
    ...(q && {
      OR: (
        ["operator", "lineName", "depStationName", "arrStationName", "bookingReference"] as const
      ).map((field) => ({ [field]: { contains: q, mode: "insensitive" as const } })),
    }),
  };
}

/** Everything but the derived columns, companions and FX, which the handlers own. */
function plainColumns(input: UpdateBusJourneyInput) {
  const {
    departureStation: _dep,
    arrivalStation: _arr,
    departureLocal: _depLocal,
    arrivalLocal: _arrLocal,
    departureFold: _depFold,
    arrivalFold: _arrFold,
    distanceKm: _distance,
    status: _status,
    companions: _companions,
    ...rest
  } = input;
  return rest;
}

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = busQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const query = parsed.data;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const where = await buildBusWhere(query, userId);
    const [total, data, counted] = await Promise.all([
      prisma.busJourney.count({ where }),
      prisma.busJourney.findMany({
        where,
        include: BUS_INCLUDE,
        orderBy: [primaryOrder(query), { id: query.order }],
        take: limit,
        skip: offset,
      }),
      prisma.busJourney.findMany({
        where,
        select: { operator: true, depStationName: true, arrStationName: true },
      }),
    ]);
    res.json({
      success: true,
      data: data.map(withBusTimes),
      // `railListSummary` reads operator and the two station names — the columns a bus row shares.
      meta: { total, limit, offset, summary: railListSummary(counted) },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const ride = await prisma.busJourney.findFirst({
      where: { id: req.params.id, userId },
      include: BUS_INCLUDE,
    });
    if (!ride) throw new AppError("Bus ride not found", 404);
    res.json({ success: true, data: withBusTimes(ride) });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  busCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      refuseStrayFold(req.body);
      const parsed = createBusJourneySchema.safeParse(req.body);
      if (!parsed.success) throw invalidInput(parsed.error);
      const input = parsed.data;
      await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });
      const documentIds = await takeDocumentIds(userId, req.body);

      const state = mergeBusJourney(null, input);
      const companions = await resolveCompanions(userId, input.companions ?? []);
      const fxColumns = await fxColumnsFor(
        { amount: input.price, currency: input.currency, date: state.departureTime },
        await getBaseCurrency(userId)
      );

      const ride = await prisma.$transaction(async (tx) => {
        const created = await tx.busJourney.create({
          data: {
            ...plainColumns(input),
            ...state,
            ...fxColumns,
            userId,
            companions: companions.map((c) => c.displayName),
          },
        });
        if (companions.length > 0) {
          await tx.busJourneyCompanion.createMany({
            data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({
              ...row,
              busJourneyId: created.id,
            })),
            skipDuplicates: true,
          });
        }
        return tx.busJourney.findUniqueOrThrow({ where: { id: created.id }, include: BUS_INCLUDE });
      });

      await linkDocuments(userId, documentIds, { type: "busJourney", id: ride.id });
      await restatusTrips(ride.tripId);
      logger.info({ operation: "bus_journey_create", busJourneyId: ride.id, userId });
      res.status(201).json({ success: true, data: withBusTimes(ride) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.busJourney.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Bus ride not found", 404);
    refuseStrayFold(req.body);
    const parsed = updateBusJourneySchema.safeParse(req.body);
    if (!parsed.success) throw invalidInput(parsed.error);
    const input = parsed.data;
    await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });

    const state = mergeBusJourney(existing, input);
    const resolved =
      input.companions !== undefined
        ? await resolveCompanions(userId, input.companions)
        : undefined;
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

    const ride = await prisma.$transaction(async (tx) => {
      if (resolved !== undefined) {
        await tx.busJourneyCompanion.deleteMany({ where: { busJourneyId: existing.id } });
        if (resolved.length > 0) {
          await tx.busJourneyCompanion.createMany({
            data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
              ...row,
              busJourneyId: existing.id,
            })),
            skipDuplicates: true,
          });
        }
      }
      await tx.busJourney.update({
        where: { id: existing.id },
        data: {
          ...plainColumns(input),
          ...state,
          ...fxColumns,
          ...(resolved !== undefined && { companions: resolved.map((c) => c.displayName) }),
        },
      });
      return tx.busJourney.findUniqueOrThrow({ where: { id: existing.id }, include: BUS_INCLUDE });
    });

    await restatusTrips(existing.tripId, ride.tripId);
    res.json({ success: true, data: withBusTimes(ride) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.busJourney.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true, tripId: true },
    });
    if (!existing) throw new AppError("Bus ride not found", 404);
    await prisma.busJourney.delete({ where: { id: existing.id } });
    await restatusTrips(existing.tripId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
