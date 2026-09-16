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
import proposeRouter from "./lodging/propose";
import {
  computeAggregates,
  sortLodgings,
  buildLodgingWhere,
  type LodgingListItem,
} from "../services/lodging/listView";
import { requireUser } from "../middleware/auth";
import {
  applyFxSnapshot,
  applyManualRate,
  resolveFxFields,
  type FxSnapshotOutcome,
} from "../services/fx/stayFx";

// Re-exported: `services/lodging/lodgingImportCommit.ts`, `lodgingChains.ts`
// and two test files name THIS module for them, and the split that moved them
// out is not a reason to rewrite their imports.
export { applyFxSnapshot, applyManualRate, resolveFxFields, type FxSnapshotOutcome };
export {
  computeAggregates,
  deriveOverallRating,
  type LodgingAggregates,
  type LodgingListItem,
} from "../services/lodging/listView";
import staysRouter from "./lodging/stays";
import {
  createLodgingSchema,
  updateLodgingSchema,
  lodgingQuerySchema,
  currencyField,
} from "../schemas/lodging";
import logger from "../utils/logger";
import {
  collectLodgingPhotoFilenames,
  removeLodgingPhotoFiles,
} from "../services/lodging/deleteLodgingPhotoFiles";
import { getBaseCurrency } from "../services/fx/snapshot";

// Re-exported: every existing import site names this module.
export { getBaseCurrency };

const router = Router();
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST/PATCH/DELETE — consistent with routes/cruises.ts.
router.use(requireWriteScope);


// Exported so routes/lodgingChains.ts's chain-detail endpoint can reuse the
// SAME include shape + aggregate derivation as the lodging list, instead of
// re-deriving stayCount/nights/overallRating/totalSpendBase a second time.
export const LODGING_INCLUDE = { stays: true, chain: true } satisfies Prisma.LodgingInclude;
export type LodgingListRow = Prisma.LodgingGetPayload<{ include: typeof LODGING_INCLUDE }>;

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

// "Is this that house?" lives in `lodging/propose` — mounted HERE so the
// literal path is matched before `/:id` could read "propose" as an id.
router.use(proposeRouter);

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
    // The photo FILES are a different matter: the cascade takes their rows and
    // with them the only record of their names, so they are read first and the
    // bytes removed after the row is gone (AUD-042).
    const photoFiles = await collectLodgingPhotoFilenames({ id: existing.id });
    await prisma.lodging.delete({ where: { id: existing.id } });
    removeLodgingPhotoFiles(photoFiles);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Stay CRUD lives in `lodging/stays` — the same paths, mounted here so the
// order Express matches in is unchanged.
router.use(staysRouter);

export default router;
