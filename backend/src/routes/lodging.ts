import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { fxPreviewLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import * as fx from "../services/fx/frankfurter";
import * as geo from "../services/geo/nominatim";
import { resolveUpdatedCoordinates } from "./lodgingGeocode";
import { checkAndUpdateAchievements } from "../utils/achievements";
import { deriveLodgingStatus } from "../shared/statusDerivation";
import {
  createLodgingSchema,
  updateLodgingSchema,
  createStaySchema,
  updateStaySchema,
  lodgingQuerySchema,
  CURRENCIES,
  type LodgingQueryInput,
} from "../schemas/lodging";
import logger from "../utils/logger";

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST/PATCH/DELETE — consistent with routes/cruises.ts.
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

// Exported so routes/lodgingChains.ts's chain-detail endpoint can reuse the
// SAME include shape + aggregate derivation as the lodging list, instead of
// re-deriving stayCount/nights/overallRating/totalSpendBase a second time.
export const LODGING_INCLUDE = { stays: true, chain: true } satisfies Prisma.LodgingInclude;
export type LodgingListRow = Prisma.LodgingGetPayload<{ include: typeof LODGING_INCLUDE }>;

interface FxSnapshotFields {
  totalPriceBase: number | null;
  fxRate: number | null;
  fxRateDate: Date | null;
  fxBaseCurrency: string | null;
}

const CLEARED_FX: FxSnapshotFields = {
  totalPriceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
};

interface RatedStay {
  ratingOverall: number | null;
}

interface AggregateStayFx {
  totalPriceBase: number | null;
  fxBaseCurrency: string | null;
}

/**
 * Sums `totalPriceBase` grouped by the currency it was snapshotted into
 * (`fxBaseCurrency`) — never across currencies. A stay snapshotted before
 * the user switched their base currency keeps its OLD `fxBaseCurrency` key
 * here forever (the snapshot itself never gets recalculated), so summing
 * everything under the CURRENT base currency's label would silently add
 * amounts that were never actually converted into it (finding 2).
 */
function sumSpendBaseByCurrency<T extends AggregateStayFx>(stays: T[]): Record<string, number> {
  const byCurrency: Record<string, number> = {};
  for (const s of stays) {
    if (s.totalPriceBase === null || s.fxBaseCurrency === null) continue;
    byCurrency[s.fxBaseCurrency] = (byCurrency[s.fxBaseCurrency] ?? 0) + s.totalPriceBase;
  }
  return byCurrency;
}

/** Average of a lodging's stays' ratingOverall (nulls ignored). null when none rated. */
export function deriveOverallRating(stays: RatedStay[]): number | null {
  const rated = stays.map((s) => s.ratingOverall).filter((v): v is number => v !== null);
  if (rated.length === 0) return null;
  return Math.round((rated.reduce((sum, v) => sum + v, 0) / rated.length) * 10) / 10;
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

interface AggregateStay extends RatedStay, AggregateStayFx {
  checkIn: Date;
  checkOut: Date;
}

export interface LodgingAggregates {
  overallRating: number | null;
  stayCount: number;
  nights: number;
  /** Sum of totalPriceBase for stays whose FX snapshot matches `currentBaseCurrency` — see sumSpendBaseByCurrency. */
  totalSpendBase: number;
  /** Full per-fxBaseCurrency breakdown (finding 2) — lets the UI show spend snapshotted under a currency the user has since moved away from, instead of silently folding it into totalSpendBase. */
  totalSpendBaseByCurrency: Record<string, number>;
}

export function computeAggregates(
  stays: AggregateStay[],
  currentBaseCurrency: string,
): LodgingAggregates {
  const totalSpendBaseByCurrency = sumSpendBaseByCurrency(stays);
  return {
    overallRating: deriveOverallRating(stays),
    stayCount: stays.length,
    nights: stays.reduce((sum, s) => sum + nightsBetween(s.checkIn, s.checkOut), 0),
    totalSpendBase: totalSpendBaseByCurrency[currentBaseCurrency] ?? 0,
    totalSpendBaseByCurrency,
  };
}

export type LodgingListItem = LodgingListRow & LodgingAggregates;

function sortLodgings(
  items: LodgingListItem[],
  sort: LodgingQueryInput["sort"],
): LodgingListItem[] {
  switch (sort) {
    case "name":
      return [...items].sort((a, b) => a.name.localeCompare(b.name));
    case "nights":
      return [...items].sort((a, b) => b.nights - a.nights);
    case "rating":
      return [...items].sort((a, b) => (b.overallRating ?? -1) - (a.overallRating ?? -1));
    case "spend":
      return [...items].sort((a, b) => b.totalSpendBase - a.totalSpendBase);
    case "checkIn": {
      const latestCheckIn = (l: LodgingListItem) =>
        l.stays.reduce((max, s) => Math.max(max, s.checkIn.getTime()), 0);
      return [...items].sort((a, b) => latestCheckIn(b) - latestCheckIn(a));
    }
    default:
      return items; // already ordered by createdAt desc from the DB query
  }
}

function buildLodgingWhere(q: LodgingQueryInput, userId: string): Prisma.LodgingWhereInput {
  const where: Prisma.LodgingWhereInput = { userId };
  if (q.type) where.type = q.type;
  if (q.chainId) where.chainId = q.chainId;
  if (q.country) where.country = q.country;

  const stayFilter: Prisma.LodgingStayWhereInput = {};
  if (q.tripId) stayFilter.tripId = q.tripId;
  if (q.year) {
    stayFilter.checkIn = {
      gte: new Date(`${q.year}-01-01T00:00:00.000Z`),
      lt: new Date(`${q.year + 1}-01-01T00:00:00.000Z`),
    };
  }
  if (Object.keys(stayFilter).length > 0) where.stays = { some: stayFilter };

  return where;
}

/**
 * Snapshot the FX conversion for a stay write (spec §7.1). A stay is billed
 * in the hotel's local currency, but the user wants cross-stay totals in one
 * base currency — every write snapshots the ECB rate for the check-in day.
 *
 * `input.checkIn` is always a full ISO-8601 UTC instant by the time it
 * reaches here: on create it's the Zod-validated string from
 * `schemas/lodging.ts` (`isoDateTimeRequired` normalizes any partial input to
 * `.toISOString()`); on a selective-refresh update it's a Prisma `DateTime`
 * read back from the DB, which is likewise stored as a real UTC instant.
 * `new Date(input.checkIn)` therefore reproduces that exact instant without
 * any local-timezone reinterpretation, so `convertToBase`'s internal
 * `date.toISOString().slice(0, 10)` reads the intended check-in calendar day
 * — never shifted by ±1 day the way it would be if we built the Date from a
 * bare "YYYY-MM-DD" string via local-midnight parsing.
 *
 * Never throws — a failed FX lookup clears the snapshot instead of failing
 * the request, so the user always keeps their stay record.
 *
 * Returns a discriminated result rather than collapsing every non-value
 * outcome into the same all-null `FxSnapshotFields` object (finding 1): a
 * caller that already has an EXISTING snapshot on file (a PATCH) needs to
 * tell "the price was explicitly removed — clear it" apart from "the ECB
 * lookup merely failed for this attempt" for logging/observability, even
 * though both still resolve to a null snapshot once the inputs themselves
 * have genuinely changed (see `resolveFxFields` at each call site).
 */
export type FxSnapshotOutcome =
  | { status: "priceRemoved" }
  | { status: "lookupFailed" }
  | { status: "snapshotted"; fields: FxSnapshotFields };

export async function applyFxSnapshot(
  input: { totalPrice?: number | null; currency?: string | null; checkIn: string | Date },
  baseCurrency: string,
): Promise<FxSnapshotOutcome> {
  if (input.totalPrice == null) return { status: "priceRemoved" };
  const currency = input.currency ?? "EUR";
  const checkInDate = new Date(input.checkIn);
  const conv = await fx.convertToBase(input.totalPrice, currency, baseCurrency, checkInDate);
  if (conv === null) return { status: "lookupFailed" };
  return {
    status: "snapshotted",
    fields: {
      totalPriceBase: conv.baseAmount,
      fxRate: conv.rate,
      fxRateDate: new Date(conv.rateDate),
      fxBaseCurrency: baseCurrency,
    },
  };
}

/**
 * Resolves an `FxSnapshotOutcome` to the fields a write should apply.
 * `priceRemoved`/`lookupFailed` both collapse to `CLEARED_FX` here because
 * both call sites only ever invoke `applyFxSnapshot` once the FX-relevant
 * inputs have ALREADY been confirmed to differ from what's stored (see
 * `fxInputsChanged` in the PATCH handler) — at that point a stale snapshot
 * would misrepresent the NEW price/currency/date, so null is the only
 * honest value, matching a genuine price removal.
 */
export function resolveFxFields(outcome: FxSnapshotOutcome): FxSnapshotFields {
  return outcome.status === "snapshotted" ? outcome.fields : CLEARED_FX;
}

export async function getBaseCurrency(userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { baseCurrency: true },
  });
  // The column is NOT NULL with a DB default of 'EUR' once a settings row
  // exists; the fallback only covers a user with no UserSettings row at all.
  return settings?.baseCurrency ?? "EUR";
}

// Query shape for GET /fx-preview — a live, read-only rate lookup for the
// stay editor's FX readout. Kept local to this file (like lodgingChains.ts's
// chainQuerySchema) since nothing else needs it.
const fxPreviewQuerySchema = z.object({
  amount: z.coerce.number().min(0),
  from: z.enum(CURRENCIES),
  // Calendar day only (YYYY-MM-DD) — the same granularity applyFxSnapshot
  // snapshots on save. No time-of-day component to avoid the local-timezone
  // reinterpretation trap that motivated isoDateTimeRequired in schemas/lodging.ts.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

function recheckAchievements(userId: string): void {
  checkAndUpdateAchievements(userId).catch((error) => {
    logger.error({
      operation: "lodging_achievement_check_failed",
      error: error instanceof Error ? error.message : error,
    });
  });
}

// ---- Lodging CRUD ----

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = lodgingQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const where = buildLodgingWhere(parsed.data, userId);
    // `nights`, `rating` and `spend` are derived from each lodging's stays,
    // not plain columns, so they cannot be pushed into a Prisma `orderBy`.
    // To keep every sort key consistent (and correct under pagination) we
    // fetch the full filtered set for this user, compute the aggregates,
    // sort in memory, and ONLY THEN slice offset/limit — sort-then-paginate,
    // never the other way around (a "sort the already-fetched page" bug
    // silently reorders a truncated slice instead of the true global order).
    const lodgings = await prisma.lodging.findMany({
      where,
      include: LODGING_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    // Fetched ONCE for the whole list — every lodging's totalSpendBase is
    // filtered against the SAME current base currency (finding 2).
    const baseCurrency = await getBaseCurrency(userId);
    const rows: LodgingListItem[] = lodgings.map((l) => ({
      ...l,
      ...computeAggregates(l.stays, baseCurrency),
    }));
    const sorted = sortLodgings(rows, parsed.data.sort);
    const offset = parsed.data.offset ?? 0;
    const limit = parsed.data.limit ?? 200;
    // `meta.total` is the count of the FULL filtered set, before the page
    // slice — without it a client asking for a page has no way to tell a
    // truncated 200-row result apart from "that's really all of them", and
    // no way to walk further pages via offset.
    res.json({
      success: true,
      data: sorted.slice(offset, offset + limit),
      meta: { total: sorted.length, limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

// Read-only preview for the stay editor's live FX readout — NEVER the
// authoritative snapshot (that stays exactly `applyFxSnapshot`, computed at
// stay create/update time and persisted on the stay row). This is a
// same-origin proxy onto the same `fx.convertToBase` helper so the frontend
// can show a rate preview without the app's CSP (`connect-src 'self'` in
// index.ts) blocking a direct browser call to the external Frankfurter API.
// Must be registered BEFORE `/:id` below — otherwise Express would match
// "fx-preview" as an `:id` path param instead of this literal route.
router.get("/fx-preview", fxPreviewLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = fxPreviewQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const baseCurrency = await getBaseCurrency(userId);
    const conv = await fx.convertToBase(
      parsed.data.amount,
      parsed.data.from,
      baseCurrency,
      new Date(`${parsed.data.date}T00:00:00.000Z`),
    );
    res.json({
      success: true,
      // null when the ECB lookup fails — the frontend must render nothing
      // rather than guess, same contract as the persisted FX snapshot fields.
      data: conv ? { ...conv, baseCurrency } : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({
      where: { id: req.params.id, userId },
      include: { chain: true, stays: { orderBy: { checkIn: "desc" } } },
    });
    if (!lodging) throw new AppError("Lodging not found", 404);
    const baseCurrency = await getBaseCurrency(userId);
    res.json({ success: true, data: { ...lodging, ...computeAggregates(lodging.stays, baseCurrency) } });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createLodgingSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    // Geocode the address the user typed in (never blocks the save — a
    // failed/empty lookup or explicit coords resolve to `null`, meaning
    // "leave coordinates as parsed", not "clear them").
    const coords = await geo.resolveCoordinates(parsed.data);

    // dataSource is provenance metadata, never client-set (finding 1) —
    // a lodging created through this endpoint was hand-entered by the user.
    const lodging = await prisma.lodging.create({
      data: { ...parsed.data, ...(coords ?? {}), userId, dataSource: "manual" },
      include: LODGING_INCLUDE,
    });
    logger.info({ operation: "lodging_create", lodgingId: lodging.id, userId });
    const baseCurrency = await getBaseCurrency(userId);
    res
      .status(201)
      .json({ success: true, data: { ...lodging, ...computeAggregates(lodging.stays, baseCurrency) } });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Lodging not found", 404);

    const parsed = updateLodgingSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;

    // See lodgingGeocode.ts — geocodes only when address/city/country
    // changed; `null` means "leave coordinates untouched", never "clear
    // them", so a failed/no-op geocode can't wipe a previously-good pin.
    const coords = await resolveUpdatedCoordinates(input, existing);

    const lodging = await prisma.lodging.update({
      where: { id: existing.id },
      data: { ...input, ...(coords ?? {}) },
      include: LODGING_INCLUDE,
    });
    const baseCurrency = await getBaseCurrency(userId);
    res.json({ success: true, data: { ...lodging, ...computeAggregates(lodging.stays, baseCurrency) } });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Lodging not found", 404);
    // LodgingStay.lodgingId is onDelete: Cascade (schema.prisma) — the DB
    // removes dependent stays itself, no manual cleanup needed here.
    await prisma.lodging.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Stay CRUD (nested under a lodging) ----

router.post("/:id/stays", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const parsed = createStaySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;

    const baseCurrency = await getBaseCurrency(userId);
    const fxOutcome = await applyFxSnapshot(input, baseCurrency);
    if (fxOutcome.status === "lookupFailed") {
      logger.warn({ operation: "lodging_fx_lookup_failed", lodgingId: lodging.id, userId });
    }
    const fxFields = resolveFxFields(fxOutcome);

    const stay = await prisma.lodgingStay.create({
      data: {
        ...input,
        ...fxFields,
        // Status follows the dates (see deriveLodgingStatus). Whatever the
        // client sent is only consulted for the one value derivation honours,
        // "cancelled" — so an old client, an importer or a stale form can no
        // longer store a status the dates contradict.
        status: deriveLodgingStatus({
          checkIn: new Date(input.checkIn),
          checkOut: new Date(input.checkOut),
          current: input.status,
        }),
        lodgingId: lodging.id,
        userId,
      },
    });

    recheckAchievements(userId);
    logger.info({ operation: "lodging_stay_create", stayId: stay.id, lodgingId: lodging.id, userId });
    res.status(201).json({ success: true, data: stay });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/stays/:stayId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: lodging.id, userId },
    });
    if (!stay) throw new AppError("Stay not found", 404);

    const parsed = updateStaySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const input = parsed.data;

    // The schema-level date-order refine only fires when BOTH checkIn and
    // checkOut are present in the SAME body. A partial PATCH that only sends
    // one of the two dates must still be validated against the resulting
    // MERGED (effective) stay — otherwise e.g. a checkIn-only update can push
    // the stay past its existing checkOut and silently store an inverted
    // date range (finding 3).
    const effectiveCheckIn = input.checkIn ? new Date(input.checkIn) : stay.checkIn;
    const effectiveCheckOut = input.checkOut ? new Date(input.checkOut) : stay.checkOut;
    if (effectiveCheckOut.getTime() < effectiveCheckIn.getTime()) {
      throw new AppError("checkOut must not precede checkIn", 400);
    }

    // Only re-run the FX snapshot when a field that feeds the conversion
    // ACTUALLY CHANGED VALUE — an unrelated edit (e.g. notes) must not touch
    // a previously-good snapshot, and must never fail the request either way.
    //
    // This MUST be a value comparison, not a key-presence check ("totalPrice"
    // in input): the real StayEditor UI always sends checkIn/checkOut/
    // status/currency/board/isAwardStay unconditionally, re-sending the
    // stay's EXISTING totalPrice/currency/checkIn on every edit (e.g. a
    // notes-only edit). A key-presence check would treat every such edit as
    // "FX inputs changed" and — if the ECB lookup happens to be down at that
    // moment — silently clear a perfectly good historical snapshot (finding
    // 1, CRITICAL). Comparing against the CURRENT stored values means a
    // resend of the same value is correctly seen as "nothing changed".
    const fxInputsChanged =
      (input.totalPrice !== undefined && input.totalPrice !== stay.totalPrice) ||
      (input.currency !== undefined && input.currency !== stay.currency) ||
      (input.checkIn !== undefined && new Date(input.checkIn).getTime() !== stay.checkIn.getTime());
    let fxFields: Partial<FxSnapshotFields> = {};
    if (fxInputsChanged) {
      const baseCurrency = await getBaseCurrency(userId);
      // `input.totalPrice` can now be an explicit `null` (finding 4 — the
      // user cleared the price). `??` would treat that null the same as
      // "not sent" and silently fall back to the OLD stay.totalPrice,
      // defeating the clear — only an omitted key (undefined) should fall
      // back to the existing value.
      const effectiveTotalPrice = input.totalPrice !== undefined ? input.totalPrice : stay.totalPrice;
      const fxOutcome = await applyFxSnapshot(
        {
          totalPrice: effectiveTotalPrice,
          currency: input.currency ?? stay.currency,
          checkIn: input.checkIn ?? stay.checkIn,
        },
        baseCurrency,
      );
      if (fxOutcome.status === "lookupFailed") {
        logger.warn({ operation: "lodging_fx_lookup_failed", stayId: stay.id, userId });
      }
      fxFields = resolveFxFields(fxOutcome);
    }

    const updated = await prisma.lodgingStay.update({
      where: { id: stay.id },
      data: {
        ...input,
        ...fxFields,
        // Derived from the EFFECTIVE (merged) dates, not from `input`, so a
        // PATCH that moves only one date still re-derives against the range
        // that will actually be stored. `current` is likewise the effective
        // status — a body omitting `status` must not lose an existing
        // cancellation, which is the one value derivation passes through.
        status: deriveLodgingStatus({
          checkIn: effectiveCheckIn,
          checkOut: effectiveCheckOut,
          current: input.status ?? stay.status,
        }),
      },
    });

    recheckAchievements(userId);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/stays/:stayId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: lodging.id, userId },
    });
    if (!stay) throw new AppError("Stay not found", 404);

    await prisma.lodgingStay.delete({ where: { id: stay.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
