import { Router, Response, NextFunction } from "express";
import type { z } from "zod";

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
import {
  isTracedDistanceSource,
  mergeRailJourney,
  tracedDistanceSourceFor,
  withTracedDistance,
} from "../services/rail/railJourneyWrite";
import {
  readStoredLine,
  resolveEditedGeometry,
  resolveJourneyGeometry,
  tracedLengthKm,
  type GeometryEdit,
  type GeometryFallbackReason,
  type JourneyGeometry,
} from "../services/rail/railGeometry";
import { resolveStationInput } from "../services/rail/railStations";
import { bindConnection } from "../services/rail/railConnection";
import { recomputeTripStatus } from "../services/tripStatusService";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";
import { linkDocuments, takeDocumentIds } from "../services/documents/documentService";
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

/**
 * A single journey also carries its booking and that booking's other legs, so
 * the detail page can show the connection it is part of. Only the fields a
 * leg list needs — the legs are links, not copies.
 */
export const RAIL_DETAIL_INCLUDE = {
  ...RAIL_INCLUDE,
  booking: {
    select: {
      id: true,
      pnr: true,
      railJourneys: {
        select: {
          id: true,
          depStationName: true,
          arrStationName: true,
          departureTime: true,
          arrivalTime: true,
          depTimezone: true,
          arrTimezone: true,
          trainCategory: true,
          trainNumber: true,
          status: true,
        },
        orderBy: [{ departureTime: "asc" }, { id: "asc" }],
      },
    },
  },
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

/**
 * A ride extends its trip's span, so every write re-derives the status of the
 * trip it was in and the trip it is in now (owner decision 6 of the rail spec)
 * — after the commit, because the derivation reads the stored rows.
 */
async function restatusTrips(...tripIds: Array<string | null | undefined>): Promise<void> {
  for (const id of new Set(tripIds.filter((t): t is string => Boolean(t)))) {
    await recomputeTripStatus(id);
  }
}

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only tokens keep read access.
router.use(requireWriteScope);

/**
 * A refused write body as a stable code plus the first offending field
 * (`departureStation`, not `departureStation.lat`) — the form maps both to
 * its own sentence in the reader's language; the Zod prose is for the log.
 */
function invalidInput(error: z.ZodError): AppError {
  const field = error.issues[0]?.path[0];
  return new AppError(
    error.message,
    400,
    "RAIL_INVALID_INPUT",
    typeof field === "string" ? field : undefined
  );
}

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
      include: RAIL_DETAIL_INCLUDE,
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
  | "lookup"
> {
  const {
    departureStation: _dep,
    arrivalStation: _arr,
    departureLocal: _depLocal,
    arrivalLocal: _arrLocal,
    distanceKm: _distance,
    status: _status,
    companions: _companions,
    lookup: _lookup,
    ...rest
  } = input;
  return rest;
}

/** Catalogue picks resolved to the catalogue's position, code and country. */
async function withResolvedStations(
  input: UpdateRailJourneyInput
): Promise<UpdateRailJourneyInput> {
  return {
    ...input,
    ...(input.departureStation && {
      departureStation: await resolveStationInput(input.departureStation),
    }),
    ...(input.arrivalStation && {
      arrivalStation: await resolveStationInput(input.arrivalStation),
    }),
  };
}

/** The geometry columns of a write; the null line is SQL NULL, not JSON null. */
function geometryColumns(
  lookup: { provider: string | null; ref: string | null },
  geo: { geometry: JourneyGeometry["geometry"]; geometrySource: string }
): Prisma.RailJourneyUncheckedUpdateInput {
  return {
    lookupProvider: lookup.provider,
    lookupRef: lookup.ref,
    geometry:
      geo.geometry === null ? Prisma.DbNull : (geo.geometry as unknown as Prisma.InputJsonValue),
    geometrySource: geo.geometrySource,
  };
}

/**
 * What a save did to the line, in `meta.geometry` beside the row (review
 * 2026-09-26, finding 4): a Transitous match saved as a straight line used to
 * be indistinguishable from a good save, so the form said "saved" and the map
 * quietly drew the chord. `fallback` names why; `kept` means a re-fetch did
 * not deliver and the frozen line stayed.
 */
interface GeometryReport {
  outcome: "unchanged" | "traced" | "straight" | "kept";
  geometrySource: string;
  fallback: GeometryFallbackReason | null;
}

function reportOf(geo: JourneyGeometry): GeometryReport {
  return {
    outcome: geo.geometrySource === "straight" ? "straight" : "traced",
    geometrySource: geo.geometrySource,
    fallback: geo.fallback,
  };
}

function editReport(edit: GeometryEdit, storedSource: string): GeometryReport {
  if (edit.kind === "unchanged") {
    return { outcome: "unchanged", geometrySource: storedSource, fallback: null };
  }
  if (edit.kind === "kept") {
    return { outcome: "kept", geometrySource: edit.geometrySource, fallback: edit.fallback };
  }
  return reportOf(edit.geo);
}

router.post(
  "/",
  railCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const parsed = createRailJourneySchema.safeParse(req.body);
      if (!parsed.success) throw invalidInput(parsed.error);
      const { connectsFrom, ...input } = parsed.data;
      // Prisma proves a trip or booking EXISTS, never whose it is (AUD-038).
      await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });
      const documentIds = await takeDocumentIds(userId, req.body);

      const merged = mergeRailJourney(null, await withResolvedStations(input));
      const lookup = { provider: input.lookup?.provider ?? null, ref: input.lookup?.ref ?? null };
      const geo = await resolveJourneyGeometry({
        lookupProvider: lookup.provider,
        lookupRef: lookup.ref,
        dep: { lat: merged.depLat, lon: merged.depLon },
        arr: { lat: merged.arrLat, lon: merged.arrLon },
      });
      const state = withTracedDistance(merged, geo.geometry && tracedLengthKm(geo.geometry));
      const companions = await resolveCompanions(userId, input.companions ?? []);
      const fxColumns = await fxColumnsFor(
        { amount: input.price, currency: input.currency, date: state.departureTime },
        await getBaseCurrency(userId)
      );

      const journey = await prisma.$transaction(async (tx) => {
        // Bound inside the transaction, so a failed create leaves the previous
        // leg without the booking it was given for this one.
        const link = connectsFrom ? await bindConnection(tx, userId, connectsFrom) : null;
        const created = await tx.railJourney.create({
          data: {
            ...plainColumns(input),
            ...state,
            ...fxColumns,
            ...(geometryColumns(lookup, geo) as Prisma.RailJourneyUncheckedCreateInput),
            ...(link && {
              bookingId: link.bookingId,
              tripId: input.tripId !== undefined ? input.tripId : link.tripId,
            }),
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

      await linkDocuments(userId, documentIds, { type: "railJourney", id: journey.id });
      await restatusTrips(journey.tripId);

      logger.info({ operation: "rail_journey_create", railJourneyId: journey.id, userId });
      res.status(201).json({ success: true, data: journey, meta: { geometry: reportOf(geo) } });
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
    if (!parsed.success) throw invalidInput(parsed.error);
    const input = parsed.data;
    await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });

    // The MERGED state, so a one-field PATCH is checked against the stored
    // rest (an arrival moved behind an untouched departure is refused here).
    const merged = mergeRailJourney(existing, await withResolvedStations(input));

    // The line is fetched again only when what it depends on actually moved
    // (resolveEditedGeometry) — the form sends both stations and the match on
    // every save, so their presence in the body says nothing.
    const lookup =
      input.lookup !== undefined
        ? { provider: input.lookup?.provider ?? null, ref: input.lookup?.ref ?? null }
        : { provider: existing.lookupProvider, ref: existing.lookupRef };
    const edit = await resolveEditedGeometry(existing, {
      lookup,
      dep: { lat: merged.depLat, lon: merged.depLon },
      arr: { lat: merged.arrLat, lon: merged.arrLon },
    });
    const written =
      edit.kind === "unchanged"
        ? null
        : edit.kind === "kept"
          ? { geometry: edit.line, geometrySource: edit.geometrySource }
          : edit.geo;
    const line = written ? written.geometry : readStoredLine(existing.geometry);
    // An untouched line keeps the length it was stored with — a converted
    // roadtrip leg carries the roadtrip's own figure, not its coarse polyline's.
    const tracedKm =
      edit.kind === "unchanged" &&
      isTracedDistanceSource(existing.distanceSource) &&
      existing.distanceKm !== null
        ? existing.distanceKm
        : line && tracedLengthKm(line);
    const state = withTracedDistance(
      merged,
      tracedKm,
      tracedDistanceSourceFor(written ? written.geometrySource : existing.geometrySource)
    );

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
          ...(written && geometryColumns(lookup, written)),
          ...(resolved !== undefined && { companions: resolved.map((c) => c.displayName) }),
        },
      });
      return tx.railJourney.findUniqueOrThrow({
        where: { id: existing.id },
        include: RAIL_INCLUDE,
      });
    });

    await restatusTrips(existing.tripId, journey.tripId);
    res.json({
      success: true,
      data: journey,
      meta: { geometry: editReport(edit, existing.geometrySource) },
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.railJourney.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true, tripId: true },
    });
    if (!existing) throw new AppError("Rail journey not found", 404);
    await prisma.railJourney.delete({ where: { id: existing.id } });
    await restatusTrips(existing.tripId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
