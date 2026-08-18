import { Router, Response, NextFunction } from "express";
import { resolveCountryCode } from "../shared/geo/countryCode";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { fxPreviewLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import * as fx from "../services/fx/resolver";
import { resolveLocation } from "./lodgingGeocode";
import { checkAndUpdateAchievements } from "../utils/achievements";
import { deriveLodgingStatus } from "../shared/statusDerivation";
import { classifyStay } from "../shared/lodgingCounting";
import { resolveStayTiming } from "../shared/lodgingTiming";
import { deriveStayOverallRating } from "../shared/ratingDerivation";
import { deriveStayTotalPrice } from "../shared/stayPricing";
import {
  createLodgingSchema,
  updateLodgingSchema,
  createStaySchema,
  updateStaySchema,
  lodgingQuerySchema,
  currencyField,
  type LodgingQueryInput,
} from "../schemas/lodging";
import { minorUnits } from "../shared/currencies";
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
  /** Which provider produced the snapshot — never inferred from the rate. */
  fxSource: fx.RateSource | null;
}

const CLEARED_FX: FxSnapshotFields = {
  totalPriceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  fxSource: null,
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

interface AggregateStay extends RatedStay, AggregateStayFx {
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  nights: number | null;
  status: string;
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
  // The check-out rule (shared/lodgingCounting): a stay counts once it is
  // over. Future and cancelled bookings contribute nothing to any figure —
  // the same verdict the stats path (calculateLodgingStats) already applies.
  const visited = stays.filter((s) => classifyStay(s) === "visited");
  const totalSpendBaseByCurrency = sumSpendBaseByCurrency(visited);
  return {
    overallRating: deriveOverallRating(visited),
    stayCount: visited.length,
    // Nights come from `resolveStayTiming`, not from a local date subtraction:
    // an undated stay can still carry an explicit night count, and a
    // month-precision one must not have its placeholder dates differenced.
    nights: visited.reduce((sum, s) => sum + resolveStayTiming(s).nights, 0),
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
        // An undated stay has no position on this axis. It sorts as if it were
        // the oldest thing in the list rather than jumping to the top on a NaN.
        l.stays.reduce((max, s) => Math.max(max, s.checkIn?.getTime() ?? 0), 0);
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
  // The filter sends an ISO code now ("DE"), so one option covers "Deutschland"
  // AND "Germany". A non-code value is still accepted verbatim: an older client
  // — and any house whose text resolves to no country at all — must keep working.
  if (q.country) {
    if (/^[A-Za-z]{2}$/.test(q.country)) where.isoCountryCode = q.country.toUpperCase();
    else where.country = q.country;
  }

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
  | { status: "missingCurrency" }
  | { status: "lookupFailed" }
  | { status: "snapshotted"; fields: FxSnapshotFields };

export async function applyFxSnapshot(
  input: { totalPrice?: number | null; currency?: string | null; checkIn?: string | Date | null },
  baseCurrency: string,
): Promise<FxSnapshotOutcome> {
  if (input.totalPrice == null) return { status: "priceRemoved" };
  // A rate is a rate ON A DAY. An undated stay has no day to look one up for,
  // and picking today's rate for a hotel from 2011 would produce a number that
  // looks converted and is not. The amount is kept in its own currency and
  // reported by `spendByCurrency`, exactly like a failed lookup.
  if (input.checkIn == null) return { status: "lookupFailed" };
  // No `?? "EUR"`. An amount whose unit we never learned is not a euro amount;
  // guessing one is how 11,662 AED became €11,662 (see the 2026-08-13 spec).
  if (!input.currency) return { status: "missingCurrency" };
  const currency = input.currency;
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
      fxSource: conv.source,
    },
  };
}

/**
 * Resolves an `FxSnapshotOutcome` to the fields a write should apply.
 * `priceRemoved`/`missingCurrency`/`lookupFailed` all collapse to `CLEARED_FX`
 * here — they differ for the CALLER (only `missingCurrency` says the amount
 * itself is unusable), but none of them yields a snapshot. They collapse because
 * both call sites only ever invoke `applyFxSnapshot` once the FX-relevant
 * inputs have ALREADY been confirmed to differ from what's stored (see
 * `fxInputsChanged` in the PATCH handler) — at that point a stale snapshot
 * would misrepresent the NEW price/currency/date, so null is the only
 * honest value, matching a genuine price removal.
 */
export function resolveFxFields(outcome: FxSnapshotOutcome): FxSnapshotFields {
  return outcome.status === "snapshotted" ? outcome.fields : CLEARED_FX;
}

/**
 * Apply a rate the user typed in.
 *
 * The contract is narrow on purpose. A manual rate is for the GAP — a currency
 * and day no provider covers — not for disagreeing with the ECB, so supplying
 * one where an automatic rate exists is a mistake worth naming rather than
 * silently preferring or silently dropping. And whatever it produces is marked
 * `manual`, because the UI must never present an estimate as an official rate.
 */
export function applyManualRate(
  auto: FxSnapshotOutcome,
  manualFxRate: number,
  totalPrice: number | null,
  checkIn: string | Date,
  baseCurrency: string,
): FxSnapshotFields {
  if (auto.status === "snapshotted") {
    throw new AppError("A rate is already available for this currency and date", 400);
  }
  // No price means nothing to convert — the rate is moot rather than wrong, so
  // the stay simply keeps no snapshot instead of the request failing.
  if (totalPrice == null) return CLEARED_FX;
  const factor = 10 ** minorUnits(baseCurrency);
  return {
    totalPriceBase: Math.round(totalPrice * manualFxRate * factor) / factor,
    fxRate: manualFxRate,
    fxRateDate: new Date(checkIn),
    fxBaseCurrency: baseCurrency,
    fxSource: "manual",
  };
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
  from: currencyField,
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

    // Both directions — see resolveLocation in lodgingGeocode.ts. A typed
    // address gets coordinates, a dropped pin gets its address filled in.
    // Never blocks the save: every failure path resolves to "no change".
    const location = await resolveLocation(parsed.data);

    // dataSource is provenance metadata, never client-set (finding 1) —
    // a lodging created through this endpoint was hand-entered by the user.
    // Derive from the EFFECTIVE country — `resolveLocation` may have filled it
    // in from the geocoder, and deriving from the payload alone would miss that.
    const created = { ...parsed.data, ...location };
    const lodging = await prisma.lodging.create({
      data: {
        ...created,
        isoCountryCode: resolveCountryCode(created.country ?? null),
        userId,
        dataSource: "manual",
      },
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

    // See resolveLocation in lodgingGeocode.ts: geocodes when the address
    // changed OR the row still has no pin, and reverse-fills any address
    // field left empty. An absent key means "leave that column untouched",
    // never "clear it", so a failed lookup can't wipe good data.
    const location = await resolveLocation(input, existing);

    // An absent `country` key means "leave it alone" — deriving from the stored
    // value would rewrite a column the request never mentioned.
    const patched = { ...input, ...location };
    const lodging = await prisma.lodging.update({
      where: { id: existing.id },
      data: {
        ...patched,
        ...(patched.country !== undefined
          ? { isoCountryCode: resolveCountryCode(patched.country) }
          : {}),
      },
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
    // totalPrice is the source of truth: the UI types it, but an importer or
    // API client may send only a per-night price — derive the total so it is
    // always stored, and the FX snapshot below converts the right amount.
    // `manualFxRate` is a request field, not a stay column — it must not reach
    // the spread below, where Prisma would reject it as an unknown argument.
    const { manualFxRate, ...body } = parsed.data;
    const input = { ...body, totalPrice: deriveStayTotalPrice(body) };

    const baseCurrency = await getBaseCurrency(userId);
    const fxOutcome = await applyFxSnapshot(input, baseCurrency);
    if (fxOutcome.status === "lookupFailed") {
      logger.warn({ operation: "lodging_fx_lookup_failed", lodgingId: lodging.id, userId });
    }
    const fxFields =
      manualFxRate != null
        ? applyManualRate(
            fxOutcome,
            manualFxRate,
            input.totalPrice,
            // A manual rate still needs a day to be stamped with. An undated
            // stay cannot have one, and applyFxSnapshot has already refused
            // the conversion above — this argument is then never read.
            input.checkIn ?? new Date(),
            baseCurrency,
          )
        : resolveFxFields(fxOutcome);

    const stay = await prisma.lodgingStay.create({
      data: {
        ...input,
        ...fxFields,
        // Status follows the dates (see deriveLodgingStatus). Whatever the
        // client sent is only consulted for the one value derivation honours,
        // "cancelled" — so an old client, an importer or a stale form can no
        // longer store a status the dates contradict.
        // With no dates there is nothing to derive from and the deriver
        // returns `current` — which is correct: an undated stay is recorded
        // after the fact, so what the client says is a statement, not a cache.
        status: deriveLodgingStatus({
          checkIn: input.checkIn ? new Date(input.checkIn) : null,
          checkOut: input.checkOut ? new Date(input.checkOut) : null,
          current: input.status,
        }),
        // Likewise derived, not accepted: the overall score follows the three
        // components wherever a stay is written — form, CSV, e-mail/PDF — so
        // an importer cannot leave it null and a client cannot store one that
        // contradicts them. `current` only carries a source-supplied overall
        // through for a stay that has no component rating at all.
        ratingOverall: deriveStayOverallRating({
          room: input.ratingRoom ?? null,
          breakfast: input.ratingBreakfast ?? null,
          service: input.ratingService ?? null,
          current: input.ratingOverall ?? null,
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
    // Same reason as the create path: this one is not a stay column.
    const { manualFxRate, ...input } = parsed.data;

    // The schema-level date-order refine only fires when BOTH checkIn and
    // checkOut are present in the SAME body. A partial PATCH that only sends
    // one of the two dates must still be validated against the resulting
    // MERGED (effective) stay — otherwise e.g. a checkIn-only update can push
    // the stay past its existing checkOut and silently store an inverted
    // date range (finding 3).
    const effectiveCheckIn = input.checkIn ? new Date(input.checkIn) : stay.checkIn;
    const effectiveCheckOut = input.checkOut ? new Date(input.checkOut) : stay.checkOut;
    // Only orderable when both ends actually exist. A stay may legitimately
    // carry one date or none at all since 2.7 (an undated hotel is still a
    // hotel), and there is no order to violate then.
    if (
      effectiveCheckIn !== null &&
      effectiveCheckOut !== null &&
      effectiveCheckOut.getTime() < effectiveCheckIn.getTime()
    ) {
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
    // totalPrice is authoritative, and what the client EXPLICITLY sends drives
    // the result — a stored total must not override a field the user just
    // changed:
    //   - an explicit totalPrice (incl. null = clear) wins outright;
    //   - else an explicit pricePerNight re-derives total = per-night × nights;
    //   - else nothing pricing-relevant was sent, so the stored total stands.
    // `undefined` means "not sent"; an explicit `null` is a clear and survives.
    let effectiveTotalPrice: number | null;
    if (input.totalPrice !== undefined) {
      effectiveTotalPrice = input.totalPrice;
    } else if (input.pricePerNight !== undefined) {
      effectiveTotalPrice = deriveStayTotalPrice({
        totalPrice: null,
        pricePerNight: input.pricePerNight,
        checkIn: effectiveCheckIn,
        checkOut: effectiveCheckOut,
      });
    } else {
      // Dates alone can change what a per-night-priced stay costs, but only when
      // the total was itself derived from per-night (no explicit total on file).
      effectiveTotalPrice =
        stay.totalPrice ??
        deriveStayTotalPrice({
          totalPrice: null,
          pricePerNight: stay.pricePerNight,
          checkIn: effectiveCheckIn,
          checkOut: effectiveCheckOut,
        });
    }

    // A manual rate sent on its own changes NOTHING about price, currency or
    // date — it is the ordinary way a user fills the gap after saving a stay
    // they were told had no rate. Without this the recompute below would skip,
    // and the rate they just typed would be dropped without a word.
    const fxInputsChanged =
      manualFxRate !== undefined ||
      effectiveTotalPrice !== stay.totalPrice ||
      (input.currency !== undefined && input.currency !== stay.currency) ||
      (input.checkIn !== undefined &&
        (input.checkIn === null
          ? stay.checkIn !== null
          : new Date(input.checkIn).getTime() !== (stay.checkIn?.getTime() ?? NaN)));
    let fxFields: Partial<FxSnapshotFields> = {};
    if (fxInputsChanged) {
      const baseCurrency = await getBaseCurrency(userId);
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
      // An explicit null is the user TAKING THE RATE BACK: fall through to the
      // automatic answer, which for a gap currency is "no rate" — the honest
      // state, not the old estimate left standing.
      fxFields =
        manualFxRate != null
          ? applyManualRate(
              fxOutcome,
              manualFxRate,
              effectiveTotalPrice,
              input.checkIn ?? stay.checkIn ?? new Date(),
              baseCurrency,
            )
          : resolveFxFields(fxOutcome);
    }

    // Same merge rule as the dates above, and the same explicit-null trap as
    // the FX block: `undefined` means "not sent" and falls back to the stored
    // value, while an explicit `null` is the user CLEARING that rating and
    // must survive into the derivation. `??` would collapse the two and make
    // a cleared component silently keep its old score.
    const effectiveRating = (
      sent: number | null | undefined,
      stored: number | null,
    ): number | null => (sent !== undefined ? sent : stored);

    const updated = await prisma.lodgingStay.update({
      where: { id: stay.id },
      data: {
        ...input,
        // totalPrice is authoritative and derived above from the merged view,
        // so it overrides whatever `...input` carried (which may be a stale
        // re-send or absent while only the per-night price changed).
        totalPrice: effectiveTotalPrice,
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
        // Derived from the EFFECTIVE (merged) ratings for the same reason: a
        // PATCH sending one component must score the row that will actually
        // be stored, not the partial body.
        ratingOverall: deriveStayOverallRating({
          room: effectiveRating(input.ratingRoom, stay.ratingRoom),
          breakfast: effectiveRating(input.ratingBreakfast, stay.ratingBreakfast),
          service: effectiveRating(input.ratingService, stay.ratingService),
          current: effectiveRating(input.ratingOverall, stay.ratingOverall),
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
