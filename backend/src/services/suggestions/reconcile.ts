import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import logger from "../../utils/logger";
import { judgeCover, loadCoverContext, type CoverContext, type Covering } from "./covered";

/**
 * Re-judge every pending place-shaped suggestion against the logbook
 * (forgejo#439) — after each write that can cover one (a place visit, a stay,
 * a flight, a trip's dates), after each scan, and before the inbox reads its
 * pending lists.
 *
 *  - covered → closed as `covered`, naming the entry (`coveredBy`), with undo;
 *  - a photo finding at an own place that only lacks the visit → that place is
 *    pre-filled, so accepting adds a visit instead of a second place;
 *  - a `covered` row whose entry is gone and that nothing else holds → open
 *    again: the cover was the logbook's word, and the logbook took it back.
 *
 * A row the user took back from `covered` (`coverUndone`) is never closed by
 * this again. Every write is status-guarded, so an answer given meanwhile wins.
 * `dryRun` counts and writes nothing — the prod-copy measurement uses it.
 */

/** The photo-finding kinds that name a place; `trip` and `stay` readings are spans. */
const PLACE_KINDS = ["visit", "place"];

export interface ReconcileCounts {
  covered: number;
  reopened: number;
  prefilled: number;
}
export interface ReconcileSummary {
  photos: ReconcileCounts;
  stays: ReconcileCounts;
}

interface Row {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  lat: number;
  lon: number;
  zone: string | null;
  tripId: string | null;
  evidenceKey: string | null;
  /** A `visit` photo finding with no place yet: "place exists, visit missing" fills it. */
  canPrefill: boolean;
  /** Taken back from `covered` by the user. */
  undone: boolean;
}

interface Plan {
  close: Array<{ row: Row; covering: Covering }>;
  reopen: Row[];
  prefill: Array<{ row: Row; placeId: string }>;
}

const empty = (): ReconcileCounts => ({ covered: 0, reopened: 0, prefilled: 0 });

function plan(rows: readonly Row[], ctx: CoverContext): Plan {
  const out: Plan = { close: [], reopen: [], prefill: [] };
  for (const row of rows) {
    const verdict = judgeCover(row, ctx);
    if (row.status === "covered") {
      if (!verdict.covered) out.reopen.push(row);
      continue;
    }
    if (row.undone) continue;
    if (verdict.covered) out.close.push({ row, covering: verdict.covered });
    else if (row.canPrefill && verdict.nearPlace)
      out.prefill.push({ row, placeId: verdict.nearPlace.id });
  }
  return out;
}

function windowOf(rows: readonly Row[]): { from: Date; to: Date } | null {
  if (!rows.length) return null;
  return {
    from: new Date(Math.min(...rows.map((r) => r.startAt.getTime()))),
    to: new Date(Math.max(...rows.map((r) => r.endAt.getTime()))),
  };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

/** What a covered row records: the rule's verdict and the entry that holds it. */
export function coveredResolution(covering: Covering, at: Date) {
  return { resolution: "covered", coveredBy: { ...covering }, at: at.toISOString() };
}

export async function reconcilePhotoSuggestions(
  userId: string,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<ReconcileCounts> {
  const found = await prisma.photoJourney.findMany({
    where: { userId, kind: { in: PLACE_KINDS }, status: { in: ["pending", "covered"] } },
    select: {
      id: true,
      status: true,
      kind: true,
      startDate: true,
      endDate: true,
      lat: true,
      lon: true,
      tripId: true,
      placeId: true,
      resolution: true,
    },
  });
  const rows: Row[] = found.map((r) => ({
    id: r.id,
    status: r.status,
    startAt: r.startDate,
    endAt: r.endDate,
    lat: r.lat,
    lon: r.lon,
    zone: zoneOfCoordinates(r.lat, r.lon),
    tripId: r.tripId,
    evidenceKey: null,
    // A `place` finding already names its place; only a `visit` one is pre-filled.
    canPrefill: r.kind === "visit" && r.placeId === null,
    undone: "coverUndone" in asRecord(r.resolution),
  }));
  const span = windowOf(rows);
  if (!span) return empty();
  const ctx = await loadCoverContext(userId, span.from, span.to, { flights: true, places: true });
  const todo = plan(rows, ctx);
  if (dryRun)
    return {
      covered: todo.close.length,
      reopened: todo.reopen.length,
      prefilled: todo.prefill.length,
    };

  const counts = empty();
  const at = new Date();
  for (const { row, covering } of todo.close) {
    const done = await prisma.photoJourney.updateMany({
      where: { id: row.id, userId, status: "pending" },
      data: {
        status: "covered",
        resolvedAt: at,
        resolution: json(coveredResolution(covering, at)),
      },
    });
    counts.covered += done.count;
  }
  for (const row of todo.reopen) {
    const done = await prisma.photoJourney.updateMany({
      where: { id: row.id, userId, status: "covered" },
      data: { status: "pending", resolvedAt: null, resolution: Prisma.DbNull },
    });
    counts.reopened += done.count;
  }
  for (const { row, placeId } of todo.prefill) {
    const done = await prisma.photoJourney.updateMany({
      where: { id: row.id, userId, status: "pending", placeId: null },
      data: { placeId },
    });
    counts.prefilled += done.count;
  }
  return counts;
}

export async function reconcileStaySuggestions(
  userId: string,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<ReconcileCounts> {
  const found = await prisma.dawarichStay.findMany({
    where: { userId, status: { in: ["pending", "covered"] } },
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      lat: true,
      lon: true,
      zone: true,
      tripId: true,
      evidence: true,
      evidenceKey: true,
    },
  });
  const evidenceOf = new Map(found.map((r) => [r.id, asRecord(r.evidence)]));
  // Only PLAIN stops: a market or venue finding stands for the whole site,
  // and one shop inside it is not the market (see `dawarich/stays/coverage.ts`).
  const rows: Row[] = found
    .filter((r) => !evidenceOf.get(r.id)!.market)
    // A covered row the old rule closed without saying by what stays closed.
    .filter((r) => r.status === "pending" || !!evidenceOf.get(r.id)!.coveredBy)
    .map((r) => ({
      id: r.id,
      status: r.status,
      startAt: r.startAt,
      endAt: r.endAt,
      lat: r.lat,
      lon: r.lon,
      zone: r.zone,
      tripId: r.tripId,
      evidenceKey: r.evidenceKey,
      canPrefill: false,
      undone: "coverUndone" in evidenceOf.get(r.id)!,
    }));
  const span = windowOf(rows);
  if (!span) return empty();
  const ctx = await loadCoverContext(userId, span.from, span.to, { flights: true });
  const todo = plan(rows, ctx);
  if (dryRun) return { covered: todo.close.length, reopened: todo.reopen.length, prefilled: 0 };

  const counts = empty();
  const at = new Date();
  for (const { row, covering } of todo.close) {
    const done = await prisma.dawarichStay.updateMany({
      where: { id: row.id, userId, status: "pending" },
      data: {
        status: "covered",
        resolvedAt: at,
        evidence: json({ ...evidenceOf.get(row.id), coveredBy: { ...covering } }),
      },
    });
    counts.covered += done.count;
  }
  for (const row of todo.reopen) {
    const { coveredBy: _gone, ...rest } = evidenceOf.get(row.id)!;
    const done = await prisma.dawarichStay.updateMany({
      where: { id: row.id, userId, status: "covered" },
      data: { status: "pending", resolvedAt: null, evidence: json(rest) },
    });
    counts.reopened += done.count;
  }
  return counts;
}

export async function reconcileSuggestions(
  userId: string,
  opts: { dryRun?: boolean } = {}
): Promise<ReconcileSummary> {
  const photos = await reconcilePhotoSuggestions(userId, opts);
  const stays = await reconcileStaySuggestions(userId, opts);
  return { photos, stays };
}

/**
 * Take a `covered` back: the row is pending again and the matcher leaves it
 * alone from now on. Returns false when no covered row of the user has that id.
 */
export async function undoCovered(
  userId: string,
  type: "photo" | "stay",
  id: string
): Promise<boolean> {
  const at = new Date().toISOString();
  if (type === "photo") {
    const row = await prisma.photoJourney.findFirst({
      where: { id, userId, status: "covered" },
      select: { resolution: true },
    });
    if (!row) return false;
    const coveredBy = asRecord(row.resolution).coveredBy ?? null;
    const done = await prisma.photoJourney.updateMany({
      where: { id, userId, status: "covered" },
      data: {
        status: "pending",
        resolvedAt: null,
        resolution: json({ coverUndone: { coveredBy, at } }),
      },
    });
    return done.count > 0;
  }
  const row = await prisma.dawarichStay.findFirst({
    where: { id, userId, status: "covered" },
    select: { evidence: true },
  });
  if (!row) return false;
  const { coveredBy = null, ...rest } = asRecord(row.evidence);
  const done = await prisma.dawarichStay.updateMany({
    where: { id, userId, status: "covered" },
    data: {
      status: "pending",
      resolvedAt: null,
      evidence: json({ ...rest, coverUndone: { coveredBy, at } }),
    },
  });
  return done.count > 0;
}

/** Accounts with a reconcile queued that has not started yet. */
const waiting = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

/**
 * A reconcile after a write — detached and coalesced, the
 * `queueDataQualityChecks` pattern: while one run waits, another write adds
 * nothing, because that run reads the new row anyway. Never rejects: the
 * write is already committed, and a failed run is logged and retried by the
 * next write, scan or inbox read.
 */
export function queueSuggestionReconcile(userId: string): Promise<void> {
  if (waiting.has(userId)) return inFlight.get(userId) ?? Promise.resolve();
  waiting.add(userId);
  const previous = inFlight.get(userId) ?? Promise.resolve();
  const next = previous.then(async () => {
    waiting.delete(userId);
    try {
      await reconcileSuggestions(userId);
    } catch (error) {
      logger.warn({
        message: "suggestion_reconcile_failed",
        context: { userId, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });
  inFlight.set(userId, next);
  void next.finally(() => {
    if (inFlight.get(userId) === next) inFlight.delete(userId);
  });
  return next;
}
