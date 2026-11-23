/**
 * The calendar's two writes into the stay inbox (spec 2026-11-23-plugins-and-
 * calendar.md, P2), beside `project.ts`: a no-venue stop that a calendar event
 * places becomes a finding of its own, and a stop that already has its pending
 * finding gains the event as evidence.
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
import { matchStop, withCalendar, type CalendarContext, type CalendarMatch } from "./calendarMatch";

export type KnownRow = {
  id: string;
  status: string;
  provider: string;
  evidence: unknown;
  sourceStartAt: Date;
  sourceEndAt: Date;
};

/** What of the run the two writes read and count. */
export interface CalendarRunContext {
  userId: string;
  rev: number;
  circles: CircleSet;
  profileZone: string;
  trips: Parameters<typeof tripForStay>[0];
  calendar: CalendarContext | null;
  findingsLeft: number;
  result: {
    created: number;
    skippedPrivate: number;
    calendarMatched: number;
    interrupted: boolean;
    failed: { calendar: number };
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

/** A stop with no venue that a calendar event places: a finding named by the event (and its rule). */
export async function createFromCalendar(
  ctx: CalendarRunContext,
  stop: Stop,
  match: CalendarMatch,
  calendarFailed: boolean,
  f: NewFinding
): Promise<{ open: boolean; go: boolean }> {
  const { userId, result } = ctx;
  const place = match.place!;
  if (inPrivacyZone(place, ctx.circles(stop.fromMs))) {
    result.skippedPrivate++;
    return { open: false, go: true };
  }
  const t = stopTimes(stop);
  const tripMatch = tripForStay(ctx.trips, f.startDay, localDay(f.endAt, ctx.profileZone));
  const evidence = withCalendar(
    {
      source: "travtrack",
      kind: "stay",
      visit: {
        durationMs: t.durationMs,
        observedMs: t.observedMs,
        inferredMs: t.inferredMs,
        gaps: stop.coverage?.gaps.length ?? 0,
        distanceM: match.evidence.geocoded?.distanceM ?? 0,
        venue: null,
      },
      // The finding exists because of the calendar: removing the source removes it while open.
      createdFrom: "calendar",
      matchingVisitId: null,
      maxGapMinutes: 0,
      uncertainties: t.inferredMs > 0 ? ["stopInferred"] : [],
      readCoverage: f.readCoverage,
      explanation: explanation("stay.stop", {
        minutes: Math.round(t.durationMs / 60_000),
        observedMinutes: Math.round(t.observedMs / 60_000),
        inferredMinutes: Math.round(t.inferredMs / 60_000),
        radiusM: RADIUS_METERS,
        distanceM: match.evidence.geocoded?.distanceM ?? 0,
      }),
      zone: f.zone,
    },
    match
  )!;
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
          name: match.name.slice(0, 200) || "—",
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
    result.calendarMatched++;
    ctx.findingsLeft--;
  }
  return { open: calendarFailed, go: true };
}

/**
 * A stop that already has its pending visit finding: the calendar may still add its evidence
 * (the finding was made while a source was down, or before the calendar was added).
 */
export async function enrichKnown(
  ctx: CalendarRunContext,
  near: readonly KnownRow[],
  stop: Stop,
  generation: bigint
): Promise<{ open: boolean; go: boolean }> {
  const row = near.length === 1 ? near[0] : null;
  const visit = (row?.evidence as { visit?: { venue?: { name?: string } | null } } | null)?.visit;
  if (!ctx.calendar || !row || row.status !== "pending" || row.provider !== "travtrack" || !visit)
    return { open: false, go: true };
  const r = await prisma.dawarichStay.findUnique({
    where: { id: row.id },
    select: { lat: true, lon: true, placeId: true, name: true },
  });
  const venue = r && r.name ? { id: r.placeId, name: r.name, lat: r.lat, lon: r.lon } : null;
  const cal = await matchStop(
    ctx.calendar,
    { fromMs: stop.fromMs, untilMs: stop.untilMs, ...stop.anchor },
    venue
  );
  if (cal.failed) ctx.result.failed.calendar++;
  const merged = cal.match ? withCalendar(row.evidence, cal.match) : null;
  if (!merged) return { open: cal.failed, go: true };
  const done = await publish(ctx.userId, generation, async (tx) => {
    const n = await tx.dawarichStay.updateMany({
      where: { id: row.id, userId: ctx.userId, status: "pending" },
      data: { evidence: merged as object },
    });
    return n.count ? "created" : "duplicate";
  });
  if (done === "stale" || done === "revoked") {
    ctx.result.interrupted = true;
    return { open: true, go: false };
  }
  if (done === "created") ctx.result.calendarMatched++;
  return { open: cal.failed, go: true };
}
