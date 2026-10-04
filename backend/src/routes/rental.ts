import { Router, Response, NextFunction } from "express";
import type { z } from "zod";

import { prisma } from "../db";
import { Prisma } from "../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rentalCreationLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  createRentalSchema,
  rentalQuerySchema,
  strayFoldKey,
  updateRentalSchema,
  type RentalQueryInput,
} from "../schemas/rental";
import { withRentalReadFields } from "../services/rental/rentalDto";
import {
  RENTAL_INCLUDE,
  createRentalRow,
  restatusTrips,
  updateRentalRow,
} from "../services/rental/rentalRowWrite";
import { rentalYear } from "../shared/rentalCounting";
import { linkDocuments, takeDocumentIds } from "../services/documents/documentService";
import { assertReferencesOwned } from "../utils/ownedReferences";
import logger from "../utils/logger";
import { rentalListSummary } from "../shared/listSummary";

/**
 * Car rentals — one row per rental contract (spec
 * docs/superpowers/specs/2026-10-01-rental-domain-design.md). Enveloped family,
 * as ADR 0001 asks of a new domain. The endpoints stay reachable whatever the
 * instance beta switch says; the switch hides the UI, it is not an
 * authorisation boundary (as rail).
 */

export { RENTAL_INCLUDE };

const DEFAULT_LIMIT = 100;

/** The farthest a station clock runs from UTC: UTC+14 ahead, UTC−12 behind. */
const MAX_AHEAD_OF_UTC_MS = 14 * 60 * 60 * 1000;
const MAX_BEHIND_UTC_MS = 12 * 60 * 60 * 1000;

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only tokens keep read access.
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

/**
 * A refused write body as a stable code plus the first offending field — the
 * form maps both to its own sentence in the reader's language.
 */
function invalidInput(error: z.ZodError): AppError {
  const field = error.issues[0]?.path[0];
  return new AppError(
    error.message,
    400,
    "RENTAL_INVALID_INPUT",
    typeof field === "string" ? field : undefined
  );
}

function refuseStrayFold(body: unknown): void {
  const key = strayFoldKey(body);
  if (key) throw new AppError(`Unknown field ${key}`, 400, "RENTAL_INVALID_INPUT", key);
}

/** A roadtrip the caller owns — a stranger's roadtrip, or a day tour, is not one (AUD-038). */
async function assertRoadtripOwned(
  userId: string,
  routeId: string | null | undefined
): Promise<void> {
  if (!routeId) return;
  const route = await prisma.tripRoute.findFirst({
    where: { id: routeId, userId, kind: "roadtrip" },
    select: { id: true },
  });
  if (!route) throw new AppError("Roadtrip not found", 404, "RENTAL_ROADTRIP_NOT_FOUND", "routeId");
}

/**
 * The rentals picked up in `year` on their pickup station's calendar. The
 * year is derived per row, so it cannot be one SQL range: the widest UTC
 * window any zone could put in that year is read, the rule picks the rows
 * (rail's `idsDepartingInYear`).
 */
async function idsPickedUpInYear(userId: string, year: number): Promise<string[]> {
  const candidates = await prisma.rentalBooking.findMany({
    where: {
      userId,
      pickupTime: {
        gte: new Date(Date.UTC(year, 0, 1) - MAX_AHEAD_OF_UTC_MS),
        lt: new Date(Date.UTC(year + 1, 0, 1) + MAX_BEHIND_UTC_MS),
      },
    },
    select: { id: true, pickupTime: true, pickupTimezone: true },
  });
  return candidates.filter((r) => rentalYear(r) === year).map((r) => r.id);
}

const SEARCH_FIELDS = [
  "provider",
  "broker",
  "confirmationNumber",
  "brokerReference",
  "pickupStationName",
  "returnStationName",
  "vehicleClass",
  "vehicleExample",
  "vehicleDriven",
  "licensePlate",
] as const;

async function buildWhere(
  query: RentalQueryInput,
  userId: string
): Promise<Prisma.RentalBookingWhereInput> {
  const statuses = query.status === undefined ? undefined : [query.status].flat();
  const q = query.q;
  return {
    userId,
    ...(statuses && { status: { in: statuses } }),
    ...(query.tripId && { tripId: query.tripId }),
    ...(query.provider && { provider: { equals: query.provider, mode: "insensitive" as const } }),
    ...(query.year !== undefined && { id: { in: await idsPickedUpInYear(userId, query.year) } }),
    ...(q && {
      OR: SEARCH_FIELDS.map((field) => ({
        [field]: { contains: q, mode: "insensitive" as const },
      })),
    }),
  };
}

// One page of the logbook; `id` breaks ties so a page boundary never skips or repeats a row.
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = rentalQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400, "RENTAL_INVALID_QUERY");
    const query = parsed.data;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const where = await buildWhere(query, userId);
    const column = query.sort === "created" ? "createdAt" : "pickupTime";
    const [total, data, counted] = await Promise.all([
      prisma.rentalBooking.count({ where }),
      prisma.rentalBooking.findMany({
        where,
        include: RENTAL_INCLUDE,
        orderBy: [{ [column]: query.order }, { id: query.order }],
        take: limit,
        skip: offset,
      }),
      // The summary strip counts the whole filtered list, not this page.
      prisma.rentalBooking.findMany({
        where,
        select: {
          provider: true,
          status: true,
          pickupTime: true,
          returnTime: true,
          pickupTimezone: true,
          returnTimezone: true,
        },
      }),
    ]);
    res.json({
      success: true,
      data: data.map(withRentalReadFields),
      meta: { total, limit, offset, summary: rentalListSummary(counted) },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const rental = await prisma.rentalBooking.findFirst({
      where: { id: req.params.id, userId },
      include: RENTAL_INCLUDE,
    });
    if (!rental) throw new AppError("Rental not found", 404, "RENTAL_NOT_FOUND");
    res.json({ success: true, data: withRentalReadFields(rental) });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  rentalCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      refuseStrayFold(req.body);
      const parsed = createRentalSchema.safeParse(req.body);
      if (!parsed.success) throw invalidInput(parsed.error);
      const input = parsed.data;
      // Prisma proves a trip EXISTS, never whose it is (AUD-038).
      await assertReferencesOwned(userId, { tripId: input.tripId });
      await assertRoadtripOwned(userId, input.routeId);
      const documentIds = await takeDocumentIds(userId, req.body);

      const rental = await createRentalRow(userId, input, { manual: true });
      await linkDocuments(userId, documentIds, { type: "rentalBooking", id: rental.id });
      logger.info({ operation: "rental_create", rentalBookingId: rental.id, userId });
      res.status(201).json({ success: true, data: withRentalReadFields(rental) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.rentalBooking.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Rental not found", 404, "RENTAL_NOT_FOUND");
    refuseStrayFold(req.body);
    const parsed = updateRentalSchema.safeParse(req.body);
    if (!parsed.success) throw invalidInput(parsed.error);
    const input = parsed.data;
    await assertReferencesOwned(userId, { tripId: input.tripId });
    await assertRoadtripOwned(userId, input.routeId);

    const rental = await updateRentalRow(userId, existing, input, { manual: true });
    res.json({ success: true, data: withRentalReadFields(rental) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.rentalBooking.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true, tripId: true },
    });
    if (!existing) throw new AppError("Rental not found", 404, "RENTAL_NOT_FOUND");
    await prisma.rentalBooking.delete({ where: { id: existing.id } });
    await restatusTrips(existing.tripId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
