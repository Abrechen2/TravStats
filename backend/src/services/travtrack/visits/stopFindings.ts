/**
 * The calendar's and the plugins' writes into the stay inbox (spec
 * 2026-11-23-plugins-and-calendar.md), beside `project.ts`: a no-venue stop
 * that the evidence places becomes a finding of its own, and a stop that
 * already has its pending finding gains the evidence.
 */
import { prisma } from "../../../db";
import { localDay } from "../../../shared/time/instant";
import { RADIUS_METERS } from "../../dawarich/stays/detect";
import { tripForStay } from "../../dawarich/stays/tripMatch";
import { explanation } from "../../locationEvidence/envelope";
import { STAY_ALGORITHM } from "../../locationEvidence/types";
import { inPrivacyZone } from "../classify";
import type { CircleSet } from "../privacyCircles";
import type { Stop } from "../legs";
import { stopTimes } from "./stops";
import { publish } from "./publish";
import {
  enrichStop,
  withEnrichment,
  type EnrichContext,
  type EnrichedPlace,
  type StopEnrichment,
} from "./enrich";

export type KnownRow = {
  id: string;
  status: string;
  provider: string;
  evidence: unknown;
  sourceStartAt: Date;
  sourceEndAt: Date;
};

/** What of the run the two writes read and count. */
export interface FindingRunContext extends EnrichContext {
  rev: number;
  circles: CircleSet;
  trips: Parameters<typeof tripForStay>[0];
  findingsLeft: number;
  result: EnrichContext["result"] & {
    created: number;
    skippedPrivate: number;
    calendarMatched: number;
    interrupted: boolean;
  };
}

export type NewFinding = {
  key: string;
  generation: bigint;
  startAt: Date;
  endAt: Date;
  startDay: string;
  zone: string;
  readCoverage: "complete" | "truncated";
};

const matched = (e: StopEnrichment) => (e.calendar ? 1 : 0);

/** A stop with no venue that the evidence places: a finding named by the event or the plugin. */
export async function createFromEnrichment(
  ctx: FindingRunContext,
  stop: Stop,
  place: EnrichedPlace,
  e: StopEnrichment,
  f: NewFinding
): Promise<{ open: boolean; go: boolean }> {
  const { userId, result } = ctx;
  if (inPrivacyZone(place, ctx.circles(stop.fromMs))) {
    result.skippedPrivate++;
    return { open: false, go: true };
  }
  const t = stopTimes(stop);
  const tripMatch = tripForStay(ctx.trips, f.startDay, localDay(f.endAt, ctx.profileZone));
  const base = {
    source: "travtrack",
    kind: "stay",
    visit: {
      durationMs: t.durationMs,
      observedMs: t.observedMs,
      inferredMs: t.inferredMs,
      gaps: stop.coverage?.gaps.length ?? 0,
      distanceM: place.distanceM,
      venue: null,
    },
    // The finding exists because of this source: removing the source removes it while open.
    createdFrom: place.createdFrom,
    matchingVisitId: null,
    maxGapMinutes: 0,
    uncertainties: t.inferredMs > 0 ? ["stopInferred"] : [],
    readCoverage: f.readCoverage,
    explanation: explanation("stay.stop", {
      minutes: Math.round(t.durationMs / 60_000),
      observedMinutes: Math.round(t.observedMs / 60_000),
      inferredMinutes: Math.round(t.inferredMs / 60_000),
      radiusM: RADIUS_METERS,
      distanceM: place.distanceM,
    }),
    zone: f.zone,
  };
  const evidence = withEnrichment(base, e) ?? base;
  const made = await publish(userId, f.generation, async (tx) => {
    const r = await tx.dawarichStay.createMany({
      skipDuplicates: true,
      data: [
        {
          userId,
          fingerprint: f.key,
          sourceStartAt: f.startAt,
          sourceEndAt: f.endAt,
          sourceLat: stop.anchor.lat,
          sourceLon: stop.anchor.lon,
          startAt: f.startAt,
          endAt: f.endAt,
          lat: place.lat,
          lon: place.lon,
          zone: f.zone,
          pointCount: 0,
          evidence: evidence as object,
          placeId: place.placeId ?? undefined,
          name: place.name.slice(0, 200) || "—",
          tripId: tripMatch.trip?.id ?? null,
          provider: "travtrack",
          providerRev: ctx.rev,
          algorithmVersion: STAY_ALGORITHM,
          evidenceKey: f.key,
        },
      ],
    });
    return r.count ? "created" : "duplicate";
  });
  if (made === "stale" || made === "revoked") {
    result.interrupted = true;
    return { open: true, go: false };
  }
  if (made === "created") {
    result.created++;
    result.calendarMatched += matched(e);
    ctx.findingsLeft--;
  }
  return { open: e.calendarFailed, go: true };
}

/** Writes merged evidence onto a pending finding under the publish rules; false when it was not. */
export async function writeEvidence(
  ctx: Pick<FindingRunContext, "userId">,
  generation: bigint,
  id: string,
  evidence: Record<string, unknown>
): Promise<"created" | "duplicate" | "stale" | "revoked"> {
  return publish(ctx.userId, generation, async (tx) => {
    const n = await tx.dawarichStay.updateMany({
      where: { id, userId: ctx.userId, status: "pending" },
      data: { evidence: evidence as object },
    });
    return n.count ? "created" : "duplicate";
  });
}

const overlapMs = (row: KnownRow, stop: Stop) =>
  Math.min(row.sourceEndAt.getTime(), stop.untilMs) -
  Math.max(row.sourceStartAt.getTime(), stop.fromMs);

/** The open TravTrack finding that shares the most time with the stop, or null. */
export function openFindingOf(near: readonly KnownRow[], stop: Stop): KnownRow | null {
  return near
    .filter((r) => r.status === "pending" && r.provider === "travtrack")
    .reduce<KnownRow | null>(
      (best, r) => (best === null || overlapMs(r, stop) > overlapMs(best, stop) ? r : best),
      null
    );
}

/**
 * A stop that already has its pending visit finding: the calendar and the plugins may still add
 * their evidence (made while a source was down, or before the source was added).
 */
export async function enrichKnown(
  ctx: FindingRunContext,
  near: readonly KnownRow[],
  stop: Stop,
  generation: bigint
): Promise<{ open: boolean; go: boolean }> {
  // Any open TravTrack finding of the stop, the stay detector's plain one included: asking only
  // findings this projection made (`evidence.visit`) left every stop the 6-hourly stay scan had
  // reached first unasked by the plugins (prod, 24.-26.11.2026: no call after the first day).
  const row = openFindingOf(near, stop);
  if ((!ctx.calendar && !ctx.plugins) || !row) return { open: false, go: true };
  const r = await prisma.dawarichStay.findUnique({
    where: { id: row.id },
    select: { lat: true, lon: true, placeId: true, name: true, zone: true },
  });
  const venue =
    r && r.name
      ? {
          id: r.placeId,
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          own: r.placeId !== null,
          distanceM: 0,
        }
      : null;
  const e = await enrichStop(
    ctx,
    { fromMs: stop.fromMs, untilMs: stop.untilMs, ...stop.anchor, zone: r?.zone ?? "UTC" },
    venue,
    undefined
  );
  const merged = withEnrichment(row.evidence, e);
  if (!merged) return { open: e.calendarFailed, go: true };
  const done = await writeEvidence(ctx, generation, row.id, merged);
  if (done === "stale" || done === "revoked") {
    ctx.result.interrupted = true;
    return { open: true, go: false };
  }
  if (done === "created") ctx.result.calendarMatched += matched(e);
  return { open: e.calendarFailed, go: true };
}
