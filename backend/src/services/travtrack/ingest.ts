import { randomUUID } from "node:crypto";

import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

import {
  inDeletedRange,
  inPrivacyZone,
  judgePoint,
  payloadHash,
  positionKey,
  type DropReason,
  type EntryRef,
  type ParsedPoint,
} from "./classify";
import { clipSpan, parseGaps, type ParsedGap } from "./gaps";
import { addLinks, entryKey, resolveEntries } from "./links";
import { markTravTrackDaysDirty, neighbourDaysOf, utcDaysOf } from "./dirtyDays";
import { takeTravTrackLock } from "./lock";

/**
 * Storing one upload of TravTrack positions (TravTrack plan T2; ported from
 * the archived location history, spec 2026-10-20 §10.2) — synchronously,
 * idempotently, in one transaction, and with an outcome for every point:
 * nothing is dropped silently, and only a non-2xx answer means "send again".
 *
 * Per point the order is zone → deleted range → duplicate: a fix inside a
 * privacy zone — one in force, or a former zone's circle from before it went
 * (`zones.ts`) — is never stored and never even compared, whatever else holds.
 *
 * A duplicate still gets the links it is missing — the trip recorder and the
 * flight recorder hand over the same fix in two uploads — and an upload never
 * removes a link. An entry this account does not own is counted `unlinked`
 * and logged; the point itself is stored.
 */

export type PointOutcome =
  | { index: number; id: string | null; outcome: "stored" | "duplicate" }
  | { index: number; id: string | null; outcome: "dropped"; reason: DropReason };

export type IngestResult = {
  uploadId: string;
  stored: number;
  duplicate: number;
  dropped: number;
  /** Links this upload added (to new and to already stored points). */
  linked: number;
  /** Entry names this account does not own: counted, never stored. */
  unlinked: number;
  /** Gap pieces stored after clipping against deleted spans. */
  gapsStored: number;
  outcomes: PointOutcome[];
};

/** How long a receipt answers a retry. */
export const RECEIPT_DAYS = 30;

type Tx = DbTransaction;

/** The stored answer for this uploadId, or null; another content under the id is refused. */
async function receiptFor(tx: Tx, userId: string, uploadId: string, hash: string) {
  const receipt = await tx.travTrackUpload.findUnique({
    where: { userId_uploadId: { userId, uploadId } },
    select: { payloadHash: true, result: true },
  });
  if (!receipt) return null;
  if (receipt.payloadHash !== hash) {
    throw new AppError(
      "This uploadId was already used with other points",
      409,
      "RECORDING_UPLOAD_ID_REUSED"
    );
  }
  return receipt.result as unknown as IngestResult;
}

/** The stored points this upload names again — by the origin's id or by position — and their ids. */
async function alreadyHeld(tx: Tx, userId: string, origin: string, points: readonly ParsedPoint[]) {
  if (points.length === 0)
    return { byRef: new Map<string, string>(), byKey: new Map<string, string>() };
  // Only the batch's own seconds: never the whole span between its first and
  // last point, which two far-apart points would stretch over years.
  const seconds = [...new Set(points.map((p) => p.tS))];
  const [byRef, byPosition] = await Promise.all([
    tx.travTrackPoint.findMany({
      where: { userId, origin, originRef: { in: points.map((p) => p.ref) } },
      select: { id: true, originRef: true },
    }),
    tx.travTrackPoint.findMany({
      where: { userId, tS: { in: seconds } },
      select: { id: true, tS: true, lat: true, lon: true },
    }),
  ]);
  return {
    byRef: new Map(byRef.map((r) => [r.originRef, r.id])),
    byKey: new Map(byPosition.map((r) => [positionKey(r), r.id])),
  };
}

/**
 * The circles of zones that are gone (removed, moved, shrunk) still covering a
 * fix of this batch: those whose exclusion ends after its earliest point.
 */
async function tombstonesFor(tx: Tx, userId: string, points: readonly ParsedPoint[]) {
  if (points.length === 0) return [];
  return tx.travTrackZoneTombstone.findMany({
    where: { userId, untilAt: { gt: new Date(Math.min(...points.map((p) => p.tMs))) } },
    select: { lat: true, lon: true, radiusM: true, untilAt: true },
  });
}

type Tombstone = { lat: number; lon: number; radiusM: number; untilAt: Date };

/** Inside a zone in force, or inside a former zone's circle from before it went. */
const protectedFix = (
  p: ParsedPoint,
  zones: readonly { lat: number; lon: number; radiusM: number }[],
  tombstones: readonly Tombstone[]
): boolean =>
  inPrivacyZone(p, zones) ||
  inPrivacyZone(
    p,
    tombstones.filter((t) => p.tMs < t.untilAt.getTime())
  );

/** The deleted spans that can touch this upload: those overlapping its points' and gaps' extent. */
async function rangesFor(
  tx: Tx,
  userId: string,
  points: readonly ParsedPoint[],
  gaps: readonly ParsedGap[]
) {
  const starts = [...points.map((p) => p.tMs), ...gaps.map((g) => g.fromMs)];
  const ends = [...points.map((p) => p.tMs + 1), ...gaps.map((g) => g.toMs)];
  if (starts.length === 0) return [];
  return tx.travTrackDeletedRange.findMany({
    where: {
      userId,
      fromAt: { lt: new Date(Math.max(...ends)) },
      toAt: { gt: new Date(Math.min(...starts)) },
    },
    select: { fromAt: true, toAt: true },
  });
}

type Judgement = {
  outcomes: PointOutcome[];
  fresh: Array<ParsedPoint & { pointId: string }>;
  /** Which stored (or newly stored) point each candidate's entries attach to. */
  attach: Array<{ pointId: string; entries: EntryRef[] }>;
};

function judgeAll(
  candidates: readonly ParsedPoint[],
  zones: readonly { lat: number; lon: number; radiusM: number }[],
  tombstones: readonly Tombstone[],
  ranges: readonly { fromAt: Date; toAt: Date }[],
  held: { byRef: Map<string, string>; byKey: Map<string, string> }
): Judgement {
  const out: Judgement = { outcomes: [], fresh: [], attach: [] };
  for (const p of candidates) {
    const key = positionKey(p);
    // The same outcome for a zone in force and a former one: the answer must
    // not tell which circles once existed.
    if (protectedFix(p, zones, tombstones)) {
      out.outcomes.push({ index: p.index, id: p.ref, outcome: "dropped", reason: "privacy_zone" });
      continue;
    }
    if (inDeletedRange(p.tMs, ranges)) {
      out.outcomes.push({ index: p.index, id: p.ref, outcome: "dropped", reason: "deleted_range" });
      continue;
    }
    const existing = held.byRef.get(p.ref) ?? held.byKey.get(key);
    if (existing) {
      out.outcomes.push({ index: p.index, id: p.ref, outcome: "duplicate" });
      out.attach.push({ pointId: existing, entries: p.entries });
      continue;
    }
    // Twice in this very batch: the first is stored, the second is its duplicate.
    const pointId = randomUUID();
    held.byRef.set(p.ref, pointId);
    held.byKey.set(key, pointId);
    out.fresh.push({ ...p, pointId });
    out.attach.push({ pointId, entries: p.entries });
    out.outcomes.push({ index: p.index, id: p.ref, outcome: "stored" });
  }
  return out;
}

/** Resolves every named entry and adds the links; returns how many were added and refused. */
async function linkAll(tx: Tx, userId: string, attach: Judgement["attach"]) {
  const named = attach.flatMap((a) => a.entries);
  if (named.length === 0) return { linked: 0, unlinked: 0 };
  const resolved = await resolveEntries(tx, userId, named);
  let unlinked = 0;
  const pairs = attach.flatMap((a) =>
    a.entries.flatMap((e) => {
      const to = resolved.get(entryKey(e));
      if (!to) {
        unlinked += 1;
        return [];
      }
      return [{ pointId: a.pointId, kind: to.kind, id: to.id }];
    })
  );
  return { linked: await addLinks(tx, userId, pairs), unlinked };
}

async function storeGaps(
  tx: Tx,
  userId: string,
  deviceId: string,
  gaps: readonly ParsedGap[],
  ranges: readonly { fromAt: Date; toAt: Date }[]
): Promise<number> {
  const pieces = gaps.flatMap((g) =>
    clipSpan(g, ranges).map((s) => ({
      userId,
      deviceId,
      reason: g.reason,
      fromAt: new Date(s.fromMs),
      toAt: new Date(s.toMs),
    }))
  );
  if (pieces.length === 0) return 0;
  const { count } = await tx.travTrackGap.createMany({ data: pieces, skipDuplicates: true });
  return count;
}

export async function ingestTravTrackPoints(input: {
  userId: string;
  deviceId: string;
  uploadId: string;
  points: readonly Record<string, unknown>[];
  gaps?: readonly Record<string, unknown>[];
}): Promise<{ result: IngestResult; replayed: boolean }> {
  const { userId, deviceId, uploadId } = input;
  const rawGaps = input.gaps ?? [];
  if (input.points.length === 0 && rawGaps.length === 0) {
    throw new AppError("An upload carries at least one point or one gap", 400, "VALIDATION_FAILED");
  }
  const gaps = parseGaps(rawGaps);
  const origin = `companion:${deviceId}`;
  const hash = payloadHash(input.points, rawGaps);

  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const stored = await receiptFor(tx, userId, uploadId, hash);
      if (stored) return { result: stored, replayed: true };

      const dropped: PointOutcome[] = [];
      const candidates: ParsedPoint[] = [];
      for (const [index, raw] of input.points.entries()) {
        const judged = judgePoint(raw, index);
        if (judged.kind === "dropped") {
          dropped.push({ index, id: judged.ref, outcome: "dropped", reason: judged.reason });
        } else {
          candidates.push(judged.point);
        }
      }

      const [ranges, held, zones, tombstones] = await Promise.all([
        rangesFor(tx, userId, candidates, gaps),
        alreadyHeld(tx, userId, origin, candidates),
        tx.travTrackPrivacyZone.findMany({
          where: { userId },
          select: { lat: true, lon: true, radiusM: true },
        }),
        tombstonesFor(tx, userId, candidates),
      ]);
      const judged = judgeAll(candidates, zones, tombstones, ranges, held);

      if (judged.fresh.length > 0) {
        await tx.travTrackPoint.createMany({
          data: judged.fresh.map((p) => ({
            id: p.pointId,
            userId,
            t: new Date(p.tMs),
            tS: p.tS,
            lat: p.lat,
            lon: p.lon,
            accuracyM: p.accuracyM,
            altitudeM: p.altitudeM,
            speedMps: p.speedMps,
            course: p.course,
            motion: p.motion,
            origin,
            originRef: p.ref,
            deviceId,
            purpose: p.purpose,
          })),
        });
      }
      // The projections (country days, E6) re-derive the days that gained a
      // point, and the neighbours that read it as context — in this
      // transaction, so a day is never stored and unmarked.
      if (judged.fresh.length > 0) {
        const fresh = judged.fresh.map((p) => ({ tMs: p.tMs, deviceId }));
        await markTravTrackDaysDirty(tx, userId, [
          ...utcDaysOf(fresh.map((p) => p.tMs)),
          ...(await neighbourDaysOf(tx, userId, fresh)),
        ]);
      }
      const { linked, unlinked } = await linkAll(tx, userId, judged.attach);
      const gapsStored = await storeGaps(tx, userId, deviceId, gaps, ranges);

      const outcomes = [...dropped, ...judged.outcomes].sort((a, b) => a.index - b.index);
      const count = (o: PointOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
      const result: IngestResult = {
        uploadId,
        stored: count("stored"),
        duplicate: count("duplicate"),
        dropped: count("dropped"),
        linked,
        unlinked,
        gapsStored,
        outcomes,
      };
      if (unlinked > 0) {
        logger.warn({ operation: "travtrack.points.unlinked", uploadId, unlinked });
      }
      await tx.travTrackUpload.create({
        data: {
          userId,
          uploadId,
          payloadHash: hash,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.travTrackUpload.deleteMany({
        where: { userId, createdAt: { lt: new Date(Date.now() - RECEIPT_DAYS * 86_400_000) } },
      });
      return { result, replayed: false };
    },
    { timeout: 60_000 }
  );
}
