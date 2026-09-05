/**
 * Everything `daysAway` needs from the database, read once (forgejo#92).
 *
 * `computeDaysAway` is pure so the overlap arithmetic can be tested against
 * hand-written dates; this is the file that goes and gets the dates. It
 * decides two things and names both:
 *
 * 1. WHICH records count. Each domain's counting rule has one home and is
 *    applied here, never restated: `countableFlightWhere` for flights,
 *    `classifyStay` for stays, `classifyVisit` for visits, and for cruises the
 *    sailed predicate `/stats/cruise` and the passport already share
 *    (`status in flown, historical`). A `visited: false` house or place is a
 *    bookmark, not a visit — the same cut `shared/lodgingCounting.ts` and
 *    `shared/placeCounting.ts` make.
 * 2. WHICH rows to fetch for a window. A year-scoped summary reports the
 *    year's days, so a record is fetched when its span TOUCHES the window —
 *    a stay from 29 December to 3 January belongs to both years — and the
 *    pure function clips the days to the window. Fetching by "starts in the
 *    window" alone would lose the New Year stay from the second year.
 *
 * Only the date columns travel. A summary is read on every dashboard open,
 * and the whole point of a date-only projection is that a thousand stays cost
 * a thousand pairs of dates and nothing else.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { classifyStay } from "../../shared/lodgingCounting";
import { classifyVisit } from "../../shared/placeCounting";
import { computeDaysAway, type DayWindow, type DaysAway } from "../../utils/stats/daysAway";

/** The sailed predicate — the cut `/stats/cruise` and the passport make. */
const SAILED_CRUISE_STATUSES = ["flown", "historical"] as const;

export interface DaysAwayScope {
  year?: number;
  fromDate?: string;
  toDate?: string;
}

/**
 * The window a summary scope describes, as inclusive ISO days — the same
 * semantics `buildWhere` gives a flight total: a year wins over a range, and a
 * range may be open at either end. An unparsable bound is dropped rather than
 * turned into an Invalid Date that Prisma would reject.
 */
export function daysAwayWindow(scope: DaysAwayScope): DayWindow | null {
  if (scope.year !== undefined) {
    return { from: `${scope.year}-01-01`, to: `${scope.year}-12-31` };
  }
  const day = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    const at = new Date(raw);
    return Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : undefined;
  };
  const from = day(scope.fromDate);
  const to = day(scope.toDate);
  return from === undefined && to === undefined ? null : { from, to };
}

const DAY_MS = 86_400_000;

/** The window's bounds as instants, for the queries. Exclusive upper bound. */
function windowInstants(window: DayWindow | null): { from: Date | null; to: Date | null } {
  return {
    from: window?.from ? new Date(`${window.from}T00:00:00Z`) : null,
    to: window?.to ? new Date(Date.parse(`${window.to}T00:00:00Z`) + DAY_MS) : null,
  };
}

/**
 * A span-shaped record touches the window when it starts before the window
 * ends and ends after the window starts. A missing end is read as the start,
 * which is what the pure function does with it too.
 */
function spanTouches<TStart extends string, TEnd extends string>(
  startCol: TStart,
  endCol: TEnd,
  window: DayWindow | null
): Record<string, unknown> {
  const { from, to } = windowInstants(window);
  const clauses: Record<string, unknown>[] = [];
  if (to !== null) clauses.push({ [startCol]: { lt: to } });
  if (from !== null) {
    clauses.push({
      OR: [{ [endCol]: { gte: from } }, { [endCol]: null, [startCol]: { gte: from } }],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

function pointTouches(col: string, window: DayWindow | null): Record<string, unknown> {
  const { from, to } = windowInstants(window);
  if (from === null && to === null) return {};
  return {
    [col]: { ...(from !== null ? { gte: from } : {}), ...(to !== null ? { lt: to } : {}) },
  };
}

export async function loadDaysAway(userId: string, scope: DaysAwayScope = {}): Promise<DaysAway> {
  const window = daysAwayWindow(scope);
  const now = new Date();

  const [flights, cruises, stays, visits] = await Promise.all([
    prisma.flight.findMany({
      where: {
        userId,
        ...countableFlightWhere(),
        ...(spanTouches("departureTime", "arrivalTime", window) as Prisma.FlightWhereInput),
      },
      select: { departureTime: true, arrivalTime: true },
    }),
    prisma.cruise.findMany({
      where: {
        userId,
        status: { in: [...SAILED_CRUISE_STATUSES] },
        ...(spanTouches("startDate", "endDate", window) as Prisma.CruiseWhereInput),
      },
      select: { startDate: true, endDate: true },
    }),
    prisma.lodgingStay.findMany({
      where: {
        userId,
        lodging: { visited: true },
        ...(spanTouches("checkIn", "checkOut", window) as Prisma.LodgingStayWhereInput),
      },
      select: { checkIn: true, checkOut: true, status: true },
    }),
    prisma.placeVisit.findMany({
      where: {
        userId,
        place: { visited: true },
        ...(pointTouches("visitedAt", window) as Prisma.PlaceVisitWhereInput),
      },
      select: { visitedAt: true },
    }),
  ]);

  return computeDaysAway({
    flights: flights.map((f) => ({ from: f.departureTime, to: f.arrivalTime })),
    cruises: cruises.map((c) => ({ from: c.startDate, to: c.endDate })),
    // "Happened" is decided from the dates, not the cached status column —
    // see `classifyStay`. A stay still ahead, or one the user is sitting in,
    // is planned and contributes nothing yet.
    lodging: stays
      .filter((s) => classifyStay(s, now) === "visited")
      .map((s) => ({ from: s.checkIn, to: s.checkOut })),
    places: visits
      .filter((v) => classifyVisit(v, now) === "visited")
      .map((v) => ({ at: v.visitedAt })),
    window,
  });
}
