import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { localDay } from "../../../shared/time/instant";
import { fromDbDate } from "../../../shared/time/localDate";
import { visitDay } from "../../places/visitTrip";
import { meters } from "./detect";
import { isOwnEntry } from "../../locationEvidence/acceptance";

/**
 * "You already wrote this down."
 *
 * A stay the user has already recorded is not a question. On the owner's
 * account (2026-10-16) 30 of 51 open stay findings sat on a place visit logged
 * live during the Korea trip — 16 of them on the very place the finding named,
 * the same day. Accepting one recorded the visit a second time. The scan only
 * ever looked for a visit at the ONE place within 100 m, inside the stay's own
 * interval, and then merely noted it in the evidence; a visit logged a few
 * minutes before the dot settled, or at a pin 150 m away, never counted.
 *
 * A finding is covered by
 *  - a place visit with a clock within `COVER_SLACK_MS` of the stay and a pin
 *    within `COVER_RADIUS_M`. The instant is `visitedAtUtc`: `visitedAt` is the
 *    place's wall clock written as fake UTC, and comparing that to the stay's
 *    real instants is nine hours off in Seoul;
 *  - a day-dated visit (or a legacy one with no instant) at that pin on the
 *    stay's local day — "I was there that day" covers any stop there that day;
 *  - a lodging stay at that pin whose check-in..check-out days hold the stay's
 *    local day — sitting in your own hotel is not a place you visited.
 *
 * Only PLAIN stops. A market or venue finding stands for the whole site, and
 * a visit to one shop inside it is not a visit to the market (the market code
 * keeps its own identity-based "already recorded" memory); treating that shop
 * as cover suppressed exactly the suggestion the market scan exists to make.
 *
 * A covered finding is never deleted: it is resolved as `covered`, and its
 * evidence names what covered it, so the inbox history can say why it left.
 */
export const COVER_RADIUS_M = 250;
export const COVER_SLACK_MS = 2 * 60 * 60_000;
const DAY_MS = 86_400_000;

export interface CoverageVisit {
  id: string;
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
  visitedZone: string | null;
  visitedPrecision: string | null;
  /** The evidence key of the finding whose acceptance made it (TravTrack plan E4). */
  suggestionRef?: string | null;
  place: { id: string; name: string; lat: number; lon: number };
}

export interface CoverageLodgingStay {
  id: string;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  lodging: { id: string; name: string; lat: number | null; lon: number | null };
}

export interface CoverageContext {
  visits: readonly CoverageVisit[];
  lodgingStays: readonly CoverageLodgingStay[];
}

export interface StayToCover {
  startAt: Date;
  endAt: Date;
  lat: number;
  lon: number;
  zone: string;
  /** The finding's neutral key: a visit made by accepting it never covers it. */
  evidenceKey?: string | null;
}

export interface StayCoverage {
  kind: "visit" | "lodging";
  /** The place visit or the lodging stay. */
  id: string;
  placeId?: string;
  lodgingId?: string;
  name: string;
  distanceM: number;
}

/** A clock the visit really carries — not a day-only date, not a legacy fake-UTC one. */
function visitInstant(v: CoverageVisit): Date | null {
  if (!v.visitedAtUtc) return null;
  if (v.visitedPrecision === "day" || v.visitedPrecision === "month") return null;
  if (v.visitedPrecision === "year") return null;
  return v.visitedAtUtc;
}

function lodgingDays(s: CoverageLodgingStay): { first: string; last: string } | null {
  const first = s.checkInDate
    ? fromDbDate(s.checkInDate)
    : s.checkIn
      ? s.checkIn.toISOString().slice(0, 10)
      : null;
  const last = s.checkOutDate
    ? fromDbDate(s.checkOutDate)
    : s.checkOut
      ? s.checkOut.toISOString().slice(0, 10)
      : null;
  return first && last ? { first, last } : null;
}

/** The nearest record that already holds this stay, or null. Pure. */
export function coverageFor(stay: StayToCover, ctx: CoverageContext): StayCoverage | null {
  const days = new Set([localDay(stay.startAt, stay.zone), localDay(stay.endAt, stay.zone)]);
  const from = stay.startAt.getTime() - COVER_SLACK_MS;
  const to = stay.endAt.getTime() + COVER_SLACK_MS;
  let best: StayCoverage | null = null;
  const consider = (c: StayCoverage) => {
    if (c.distanceM < COVER_RADIUS_M && (!best || c.distanceM < best.distanceM)) best = c;
  };
  for (const v of ctx.visits) {
    if (isOwnEntry(v, stay.evidenceKey)) continue;
    const instant = visitInstant(v);
    const holds = instant
      ? instant.getTime() >= from && instant.getTime() <= to
      : (() => {
          const day = visitDay(v);
          return day !== null && days.has(day);
        })();
    if (!holds) continue;
    consider({
      kind: "visit",
      id: v.id,
      placeId: v.place.id,
      name: v.place.name,
      distanceM: Math.round(meters(v.place, stay)),
    });
  }
  for (const s of ctx.lodgingStays) {
    const { lat, lon } = s.lodging;
    if (lat === null || lon === null) continue;
    const span = lodgingDays(s);
    if (!span || ![...days].some((d) => d >= span.first && d <= span.last)) continue;
    consider({
      kind: "lodging",
      id: s.id,
      lodgingId: s.lodging.id,
      name: s.lodging.name,
      distanceM: Math.round(meters({ lat, lon }, stay)),
    });
  }
  return best;
}

/**
 * Every visit and lodging stay that could cover a stay between `from` and
 * `to`. A local day starts up to 14 h before and ends up to 12 h after its UTC
 * date, so the day-dated columns get one day of margin on each side.
 */
export async function loadCoverage(userId: string, from: Date, to: Date): Promise<CoverageContext> {
  const instants = {
    gte: new Date(from.getTime() - COVER_SLACK_MS),
    lte: new Date(to.getTime() + COVER_SLACK_MS),
  };
  const days = {
    gte: new Date(Date.parse(from.toISOString().slice(0, 10)) - DAY_MS),
    lte: new Date(Date.parse(to.toISOString().slice(0, 10)) + 2 * DAY_MS),
  };
  const [visits, lodgingStays] = await Promise.all([
    prisma.placeVisit.findMany({
      where: {
        userId,
        OR: [
          { visitedAtUtc: instants },
          { visitedAtUtc: days },
          { visitedAtUtc: null, visitedAt: days },
        ],
      },
      select: {
        id: true,
        visitedAt: true,
        visitedAtUtc: true,
        visitedZone: true,
        visitedPrecision: true,
        suggestionRef: true,
        place: { select: { id: true, name: true, lat: true, lon: true } },
      },
    }),
    prisma.lodgingStay.findMany({
      where: {
        userId,
        status: { not: "cancelled" },
        lodging: { lat: { not: null }, lon: { not: null } },
        OR: [
          { checkInDate: { lte: days.lte }, checkOutDate: { gte: days.gte } },
          { checkInDate: null, checkIn: { lte: days.lte }, checkOut: { gte: days.gte } },
        ],
      },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        checkInDate: true,
        checkOutDate: true,
        lodging: { select: { id: true, name: true, lat: true, lon: true } },
      },
    }),
  ]);
  return { visits, lodgingStays };
}

/** What a covered finding's evidence carries, for the inbox history. */
export function coveredEvidence(evidence: unknown, coverage: StayCoverage): Prisma.InputJsonValue {
  return {
    ...((evidence ?? {}) as Record<string, unknown>),
    coveredBy: { ...coverage },
  } as unknown as Prisma.InputJsonValue;
}

/**
 * Resolve every pending plain-stop finding a record now covers. The visit is often
 * logged AFTER the scan made the finding (live, on the phone), so this runs
 * after each scan and before the inbox reads its pending list. Returns how
 * many were resolved.
 */
export async function resolveCoveredStays(userId: string): Promise<number> {
  const pending = await prisma.dawarichStay.findMany({
    where: { userId, status: "pending" },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      lat: true,
      lon: true,
      zone: true,
      evidence: true,
      evidenceKey: true,
    },
  });
  const plain = pending.filter((p) => !(p.evidence as { market?: unknown } | null)?.market);
  if (!plain.length) return 0;
  const from = new Date(Math.min(...plain.map((p) => p.startAt.getTime())));
  const to = new Date(Math.max(...plain.map((p) => p.endAt.getTime())));
  const ctx = await loadCoverage(userId, from, to);
  let resolved = 0;
  for (const row of plain) {
    const coverage = coverageFor(row, ctx);
    if (!coverage) continue;
    // Status-guarded: a review that resolved the row meanwhile wins.
    const done = await prisma.dawarichStay.updateMany({
      where: { id: row.id, userId, status: "pending" },
      data: {
        status: "covered",
        resolvedAt: new Date(),
        evidence: coveredEvidence(row.evidence, coverage),
      },
    });
    resolved += done.count;
  }
  return resolved;
}
