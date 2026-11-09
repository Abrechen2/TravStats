import { Router, Response, NextFunction } from "express";
import type { z } from "zod";

import { prisma, type DbTransaction } from "../db";
import { Prisma } from "../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { busCreationLimiter } from "../middleware/rateLimit";
import { busRouteLimiter } from "../middleware/busRouteLimiter";
import { isSharedDemoUser, rejectDemo } from "../middleware/demoGuard";
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
import { withBusCo2 } from "../services/co2/rideDto";
import { withBusTimes } from "../services/bus/timesDto";
import { propagateDelete, propagateWrite, shareSnapshot } from "../services/sharing/propagate";
import {
  busGeometryColumns,
  busGeometryReport,
  fetchBusLine,
  resolveEditedBusLine,
  withRoutedDistance,
  writtenLine,
  type BusLineEdit,
} from "../services/bus/busRouting";
import {
  BusRoutingUnavailableError,
  routeStraightRide,
  startRouteAllJob,
} from "../services/bus/busRouteAgain";
import { describeRoutingAvailability } from "../services/tour/routing/resolveProvider";
import { restatusTrips } from "../services/trip/restatusTrips";
import { busYear } from "../shared/busCounting";
import {
  planCompanions,
  resolveCompanions,
  upsertPlannedCompanions,
} from "../services/companionService";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";
import { idsInLocalYear } from "../services/transport/localYear";
import { linkCompanions, replaceCompanionLinks } from "../services/transport/companionLinks";
import { fxColumnsOnEdit } from "../services/transport/fxOnEdit";
import { fileReceipts, takeDocumentIds } from "../services/documents/documentService";
import { assertReferencesOwned } from "../utils/ownedReferences";
import { createOnce, takeClientRef, type ClaimClientRef } from "../services/sync/clientRef";
import logger from "../utils/logger";
import ticketRoutes from "./bus/tickets";
import { railListSummaryFromGroups } from "../shared/listSummary";

/**
 * Bus rides — one row per coach ride (spec
 * docs/superpowers/specs/2026-10-07-bus-domain-design.md). Enveloped family, as
 * ADR 0001 asks of a new domain. The endpoints stay reachable whatever the
 * user's domain toggle says; the toggle hides the UI, it is not a boundary.
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

/** The rides that left in `year` on their departure terminal's calendar — `busYear`'s rule, per row. */
async function idsDepartingInYear(userId: string, year: number): Promise<string[]> {
  return idsInLocalYear(
    year,
    (window) =>
      prisma.busJourney.findMany({
        where: { userId, departureTime: window },
        select: { id: true, departureTime: true, depTimezone: true },
      }),
    (r) => busYear({ ...r, arrivalTime: null, arrTimezone: null })
  );
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
router.use(ticketRoutes);

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
      // The summary strip counts the whole filtered list, not this page — grouped in
      // SQL, so the work is the distinct (operator, stations) combinations.
      prisma.busJourney.groupBy({
        by: ["operator", "depStationName", "arrStationName"],
        where,
        _count: { _all: true },
        orderBy: [{ operator: "asc" }, { depStationName: "asc" }, { arrStationName: "asc" }],
      }),
    ]);
    res.json({
      success: true,
      data: data.map((r) => withBusCo2(withBusTimes(r))),
      // `railListSummary` reads operator and the two station names — the columns a bus row shares.
      meta: {
        total,
        limit,
        offset,
        summary: railListSummaryFromGroups(
          counted.map(({ _count, ...names }) => ({ ...names, count: _count._all }))
        ),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Does this instance have a routing provider? The form says once, plainly,
 * when it has none ("without one, rides stay a straight line"). Never leaks a
 * key or a URL — only whether routing works and which provider answers.
 */
router.get("/routing", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    // The demo account cannot spend the routing key, so for it there is none.
    const availability = (await isSharedDemoUser(userId))
      ? { configured: false, providerId: null }
      : await describeRoutingAvailability(userId);
    res.json({ success: true, data: availability });
  } catch (err) {
    next(err);
  }
});

/** Route every straight ride as a background job; per-ride outcomes are the job's result. */
router.post(
  "/route-straight",
  busRouteLimiter,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const job = await startRouteAllJob(userId);
      res.status(202).json({ success: true, data: { jobId: job.id } });
    } catch (err) {
      next(
        err instanceof BusRoutingUnavailableError
          ? new AppError("This instance has no routing provider", 409, "BUS_NO_ROUTING_PROVIDER")
          : err
      );
    }
  }
);

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const ride = await prisma.busJourney.findFirst({
      where: { id: req.params.id, userId },
      include: BUS_INCLUDE,
    });
    if (!ride) throw new AppError("Bus ride not found", 404);
    res.json({ success: true, data: withBusCo2(withBusTimes(ride)) });
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
      // An outbox replay carries the key it minted (forgejo#283): a repeat
      // answers the ride the first POST made, 200 instead of 201.
      const { clientRef, rest: body } = takeClientRef(req.body);
      const { created, result } = await createBusRideOnce(userId, body, clientRef);
      res
        .status(created ? 201 : 200)
        .json({ success: true, data: result.ride, meta: { geometry: result.report } });
    } catch (err) {
      next(err);
    }
  }
);

/** The create behind POST /bus, callable from a service (see `createRailRideOnce`). */
export function createBusRideOnce(userId: string, body: unknown, clientRef: string | null) {
  return createOnce({
    userId,
    clientRef,
    kind: "bus",
    payload: body,
    create: (claim) => createBusRide(userId, body, claim),
    replay: async (id) => {
      const ride = await prisma.busJourney.findFirst({
        where: { id, userId },
        include: BUS_INCLUDE,
      });
      return (
        ride && {
          ride: withBusCo2(withBusTimes(ride)),
          report: busGeometryReport({ kind: "unchanged" }, ride.geometrySource),
        }
      );
    },
  });
}

/** A bus ride ready to be written: the slow work is done; see `PreparedRailRide`. */
export interface PreparedBusRide {
  write: (tx: DbTransaction, claim?: ClaimClientRef) => Promise<BusRideRow>;
  result: (ride: BusRideRow) => {
    ride: ReturnType<typeof withBusCo2>;
    report: ReturnType<typeof busGeometryReport>;
  };
}
type BusRideRow = Prisma.BusJourneyGetPayload<{ include: typeof BUS_INCLUDE }>;

export async function prepareBusRide(userId: string, body: unknown): Promise<PreparedBusRide> {
  refuseStrayFold(body);
  const parsed = createBusJourneySchema.safeParse(body);
  if (!parsed.success) throw invalidInput(parsed.error);
  const input = parsed.data;
  await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });
  const documentIds = await takeDocumentIds(userId, body);

  const merged = mergeBusJourney(null, input);
  // Fetched once and frozen with the row; a failure stores the chord and says
  // why in `meta.geometry`. Bounded by a timeout well under the client's.
  const line = await fetchBusLine(userId, {
    ...merged,
    lineName: input.lineName ?? null,
    departureTime: merged.departureTime,
  });
  const edit: BusLineEdit = { kind: "fetched", line };
  const state = withRoutedDistance(merged, null, edit);
  const plannedCompanions = planCompanions(input.companions ?? []);
  const fxColumns = await fxColumnsFor(
    { amount: input.price, currency: input.currency, date: state.departureTime },
    await getBaseCurrency(userId)
  );

  const write = async (tx: DbTransaction, claim: ClaimClientRef = async () => {}) => {
    const created = await tx.busJourney.create({
      data: {
        ...plainColumns(input),
        ...state,
        ...busGeometryColumns(line),
        ...fxColumns,
        userId,
        companions: plannedCompanions.map((c) => c.displayName),
      },
    });
    // Upserted here, inside the transaction: the preparation above writes nothing.
    const companions = await upsertPlannedCompanions(tx, userId, plannedCompanions);
    await linkCompanions(tx.busJourneyCompanion, "busJourneyId", created.id, companions);
    await propagateWrite(tx, userId, "bus", created.id);
    await claim(tx, created.id);
    // Filed inside the create, so a failure rolls the ride and its claim back
    // and the outbox replay files the receipt (it used to run after commit).
    await fileReceipts(tx, userId, documentIds, { type: "busJourney", id: created.id });
    await restatusTrips([created.tripId], tx);
    return tx.busJourney.findUniqueOrThrow({ where: { id: created.id }, include: BUS_INCLUDE });
  };

  return {
    write,
    result: (ride) => {
      logger.info({ operation: "bus_journey_create", busJourneyId: ride.id, userId });
      return { ride: withBusCo2(withBusTimes(ride)), report: busGeometryReport(edit, "straight") };
    },
  };
}

async function createBusRide(userId: string, body: unknown, claim: ClaimClientRef) {
  const prepared = await prepareBusRide(userId, body);
  const ride = await prisma.$transaction((tx) => prepared.write(tx, claim));
  return prepared.result(ride);
}

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

    const merged = mergeBusJourney(existing, input);
    // Fetched again only when a terminal's coordinates changed; a failed
    // re-fetch keeps the frozen road line (resolveEditedBusLine).
    const edit = await resolveEditedBusLine(userId, existing, {
      ...merged,
      lineName: input.lineName,
      departureTime: merged.departureTime,
    });
    const state = withRoutedDistance(merged, existing, edit);
    const written = writtenLine(edit);
    const resolved =
      input.companions !== undefined
        ? await resolveCompanions(userId, input.companions)
        : undefined;
    const fxColumns = await fxColumnsOnEdit(userId, input, existing, state.departureTime);

    const ride = await prisma.$transaction(async (tx) => {
      const before = await shareSnapshot(tx, "bus", existing.id);
      if (resolved !== undefined) {
        await replaceCompanionLinks(tx.busJourneyCompanion, "busJourneyId", existing.id, resolved);
      }
      await tx.busJourney.update({
        where: { id: existing.id },
        data: {
          ...plainColumns(input),
          ...state,
          ...(written && busGeometryColumns(written)),
          ...fxColumns,
          ...(resolved !== undefined && { companions: resolved.map((c) => c.displayName) }),
        },
      });
      await propagateWrite(tx, userId, "bus", existing.id, before);
      return tx.busJourney.findUniqueOrThrow({ where: { id: existing.id }, include: BUS_INCLUDE });
    });

    await restatusTrips([existing.tripId, ride.tripId]);
    res.json({
      success: true,
      data: withBusCo2(withBusTimes(ride)),
      meta: { geometry: busGeometryReport(edit, existing.geometrySource) },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * "Route again": give one straight ride its road line now. 200 in every case
 * that is not a refusal — a provider that did not deliver is `outcome:
 * straight` with its reason, exactly as on save, never a 5xx for the ride.
 * Idempotent: a ride that already has its line answers `unchanged`.
 */
router.post(
  "/:id/route",
  busRouteLimiter,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const report = await routeStraightRide(userId, req.params.id);
      if (!report) throw new AppError("Bus ride not found", 404);
      const ride = await prisma.busJourney.findFirstOrThrow({
        where: { id: req.params.id, userId },
        include: BUS_INCLUDE,
      });
      res.json({ success: true, data: withBusCo2(withBusTimes(ride)), meta: { geometry: report } });
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.busJourney.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true, tripId: true },
    });
    if (!existing) throw new AppError("Bus ride not found", 404);
    await prisma.$transaction(async (tx) => {
      const gone = await shareSnapshot(tx, "bus", existing.id);
      await tx.busJourney.delete({ where: { id: existing.id } });
      await propagateDelete(tx, userId, gone);
    });
    await restatusTrips([existing.tripId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
