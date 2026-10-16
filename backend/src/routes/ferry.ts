/** Ferry crossings (dennis/TravStats forgejo#293). */
import { Router, Response, NextFunction } from "express";
import liveRoutes from "./ferry/live";
import ticketRoutes from "./ferry/tickets";
import type { z } from "zod";

import { prisma } from "../db";
import { Prisma } from "../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { ferryCreationLimiter } from "../middleware/ferryCreationLimiter";
import { AppError } from "../middleware/errorHandler";
import {
  ferryQuerySchema,
  createFerryJourneySchema,
  strayFerryFoldKey,
  updateFerryJourneySchema,
  type FerryQueryInput,
  type UpdateFerryJourneyInput,
} from "../schemas/ferry";
import { mergeFerryJourney } from "../services/ferry/ferryJourneyWrite";
import { withFerryTimes } from "../services/ferry/timesDto";
import { restatusTrips } from "../services/trip/restatusTrips";
import { ferryYear } from "../shared/ferryCounting";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";
import { linkDocumentsInTx, takeDocumentIds } from "../services/documents/documentService";
import { assertReferencesOwned } from "../utils/ownedReferences";
import logger from "../utils/logger";
import { createOnce, takeClientRef, type ClaimClientRef } from "../services/sync/clientRef";
import { requestedBaseVersion, sendVersionConflict } from "../services/sync/versionPrecondition";
import { railListSummary } from "../shared/listSummary";

export const FERRY_INCLUDE = {
  trip: { select: { id: true, name: true, color: true } },
} satisfies Prisma.FerryJourneyInclude;

const DEFAULT_LIMIT = 100;

const SORT_COLUMN: Record<
  FerryQueryInput["sort"],
  keyof Prisma.FerryJourneyOrderByWithRelationInput
> = {
  departure: "departureTime",
  distance: "distanceKm",
  created: "createdAt",
};

function primaryOrder(query: FerryQueryInput): Prisma.FerryJourneyOrderByWithRelationInput {
  const column = SORT_COLUMN[query.sort];
  return column === "distanceKm"
    ? { distanceKm: { sort: query.order, nulls: "last" } }
    : { [column]: query.order };
}

function refuseStrayFold(body: unknown): void {
  const key = strayFerryFoldKey(body);
  if (key) throw new AppError(`Unknown field ${key}`, 400, "FERRY_INVALID_INPUT", key);
}

function invalidInput(error: z.ZodError): AppError {
  const field = error.issues[0]?.path[0];
  return new AppError(
    error.message,
    400,
    "FERRY_INVALID_INPUT",
    typeof field === "string" ? field : undefined
  );
}

/** Thrown inside a write transaction when the version claim found no row to move. */
class FerryVersionMoved extends Error {}

/**
 * A claim that moved nothing: the crossing is gone (a racing delete — 404) or
 * at another version (409 with the crossing as it is now). Ferry has no sync
 * change log, so `changedFields` is null — "compare yourself" in the shared
 * shape. The 409 used to carry only `{error, code}`.
 */
async function answerMovedVersion(
  res: Response,
  userId: string,
  id: string,
  baseVersion: string
): Promise<void> {
  const current = await prisma.ferryJourney.findFirst({
    where: { id, userId },
    include: FERRY_INCLUDE,
  });
  if (!current) throw new AppError("Ferry ride not found", 404);
  sendVersionConflict(res, {
    entity: "ferry_journey",
    id,
    baseVersion,
    currentVersion: current.updatedAt.toISOString(),
    changedFields: null,
    current: JSON.parse(JSON.stringify(withFerryTimes(current))) as Record<string, unknown>,
  });
}

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const MAX_AHEAD_OF_UTC_MS = 14 * 60 * 60 * 1000;
const MAX_BEHIND_UTC_MS = 12 * 60 * 60 * 1000;

async function idsDepartingInYear(userId: string, year: number): Promise<string[]> {
  const candidates = await prisma.ferryJourney.findMany({
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
    .filter((r) => ferryYear({ ...r, arrivalTime: null, arrTimezone: null }) === year)
    .map((r) => r.id);
}

export async function buildFerryWhere(
  query: Pick<FerryQueryInput, "status" | "q" | "year" | "tripId">,
  userId: string
): Promise<Prisma.FerryJourneyWhereInput> {
  const statuses = query.status === undefined ? undefined : [query.status].flat();
  const q = query.q;
  return {
    userId,
    ...(statuses && { status: { in: statuses } }),
    ...(query.tripId && { tripId: query.tripId }),
    ...(query.year !== undefined && { id: { in: await idsDepartingInYear(userId, query.year) } }),
    ...(q && {
      OR: (
        ["operator", "vesselName", "depStationName", "arrStationName", "bookingReference"] as const
      ).map((field) => ({ [field]: { contains: q, mode: "insensitive" as const } })),
    }),
  };
}

function plainColumns(input: UpdateFerryJourneyInput) {
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
router.use(ticketRoutes);
router.use(liveRoutes);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = ferryQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const query = parsed.data;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const where = await buildFerryWhere(query, userId);
    const [total, data, counted] = await Promise.all([
      prisma.ferryJourney.count({ where }),
      prisma.ferryJourney.findMany({
        where,
        include: FERRY_INCLUDE,
        orderBy: [primaryOrder(query), { id: query.order }],
        take: limit,
        skip: offset,
      }),
      prisma.ferryJourney.findMany({
        where,
        select: { operator: true, depStationName: true, arrStationName: true },
      }),
    ]);
    res.json({
      success: true,
      data: data.map(withFerryTimes),
      // `railListSummary` reads operator and the two station names — the columns a ferry row shares.
      meta: { total, limit, offset, summary: railListSummary(counted) },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const ride = await prisma.ferryJourney.findFirst({
      where: { id: req.params.id, userId },
      include: FERRY_INCLUDE,
    });
    if (!ride) throw new AppError("Ferry ride not found", 404);
    res.json({ success: true, data: withFerryTimes(ride) });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  ferryCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const { clientRef, rest: body } = takeClientRef(req.body);
      const { created, result } = await createOnce({
        userId,
        clientRef,
        kind: "ferry",
        payload: body,
        create: (claim) => createFerryRide(userId, body, claim),
        replay: async (id) => {
          const ride = await prisma.ferryJourney.findFirst({
            where: { id, userId },
            include: FERRY_INCLUDE,
          });
          return ride ? withFerryTimes(ride) : null;
        },
      });
      await restatusTrips([result.tripId]);
      res.status(created ? 201 : 200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

async function createFerryRide(userId: string, body: unknown, claim: ClaimClientRef) {
  refuseStrayFold(body);
  const parsed = createFerryJourneySchema.safeParse(body);
  if (!parsed.success) throw invalidInput(parsed.error);
  const input = parsed.data;
  await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });
  const documentIds = await takeDocumentIds(userId, body);

  const state = mergeFerryJourney(null, input);
  const companions = await resolveCompanions(userId, input.companions ?? []);
  const fxColumns = await fxColumnsFor(
    { amount: input.price, currency: input.currency, date: state.departureTime },
    await getBaseCurrency(userId)
  );

  const ride = await prisma.$transaction(async (tx) => {
    const created = await tx.ferryJourney.create({
      data: {
        ...plainColumns(input),
        ...state,
        ...fxColumns,
        userId,
        companions: companions.map((c) => c.displayName),
      },
    });
    if (companions.length > 0) {
      await tx.ferryJourneyCompanion.createMany({
        data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({
          ...row,
          ferryJourneyId: created.id,
        })),
        skipDuplicates: true,
      });
    }
    await claim(tx, created.id);
    const linked = await linkDocumentsInTx(tx, userId, documentIds, {
      type: "ferryJourney",
      id: created.id,
    });
    if (linked !== new Set(documentIds).size) {
      throw new AppError("A document was linked elsewhere during creation", 409);
    }
    return tx.ferryJourney.findUniqueOrThrow({
      where: { id: created.id },
      include: FERRY_INCLUDE,
    });
  });

  logger.info({ operation: "ferry_journey_create", ferryJourneyId: ride.id, userId });
  return withFerryTimes(ride);
}

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.ferryJourney.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Ferry ride not found", 404);
    refuseStrayFold(req.body);
    const baseVersion = requestedBaseVersion(req);
    const parsed = updateFerryJourneySchema.safeParse(req.body);
    if (!parsed.success) throw invalidInput(parsed.error);
    const input = parsed.data;
    if (existing.roadtripLegId && input.tripId !== undefined && input.tripId !== existing.tripId) {
      throw new AppError("Unlink the roadtrip leg before moving this crossing", 409);
    }
    await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });

    const state = mergeFerryJourney(existing, input);
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

    let ride;
    try {
      ride = await prisma.$transaction(async (tx) => {
        // Claim the read version atomically inside the same transaction as the edit.
        if (baseVersion !== null) {
          const claimed = await tx.ferryJourney.updateMany({
            where: { id: existing.id, userId, updatedAt: new Date(baseVersion) },
            data: { updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)) },
          });
          if (claimed.count !== 1) throw new FerryVersionMoved();
        }
        if (resolved !== undefined) {
          await tx.ferryJourneyCompanion.deleteMany({ where: { ferryJourneyId: existing.id } });
          if (resolved.length > 0) {
            await tx.ferryJourneyCompanion.createMany({
              data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
                ...row,
                ferryJourneyId: existing.id,
              })),
              skipDuplicates: true,
            });
          }
        }
        await tx.ferryJourney.update({
          where: { id: existing.id },
          data: {
            ...plainColumns(input),
            ...state,
            updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
            ...fxColumns,
            ...(resolved !== undefined && { companions: resolved.map((c) => c.displayName) }),
          },
        });
        return tx.ferryJourney.findUniqueOrThrow({
          where: { id: existing.id },
          include: FERRY_INCLUDE,
        });
      });
    } catch (err) {
      if (!(err instanceof FerryVersionMoved) || baseVersion === null) throw err;
      await answerMovedVersion(res, userId, existing.id, baseVersion);
      return;
    }

    await restatusTrips([existing.tripId, ride.tripId]);
    res.json({ success: true, data: withFerryTimes(ride) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.ferryJourney.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true, tripId: true },
    });
    if (!existing) throw new AppError("Ferry ride not found", 404);
    const baseVersion = requestedBaseVersion(req);
    const deleted = await prisma.ferryJourney.deleteMany({
      where: {
        id: existing.id,
        userId,
        ...(baseVersion === null ? {} : { updatedAt: new Date(baseVersion) }),
      },
    });
    if (deleted.count !== 1) {
      // Only a base version can make a found row miss; without one it was a
      // racing delete, and the crossing is simply gone.
      if (baseVersion === null) throw new AppError("Ferry ride not found", 404);
      await answerMovedVersion(res, userId, existing.id, baseVersion);
      return;
    }
    await restatusTrips([existing.tripId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
