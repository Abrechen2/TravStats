import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import { profileZoneOf } from "../../shared/time/profileZone";
import type { TimeValue } from "../../shared/time/wire";
import { getAirportTimezone } from "../../utils/timezone";
import { flightTimes } from "../flights/timesDto";
import { homePlaceSchema } from "../../schemas/companionData";
import { TRIP_RECORDING_TRIP_SELECT, tripSpanInstants } from "../tripRecording/bounds";
import type { StoredPoint } from "../tripRecording/segments";
import { dayAfter, midnightOf } from "./range";
import { readSafeTravTrack, type SafeSpan, type Span } from "./readSafe";

/**
 * One day of the account's TravTrack history (TravTrack plan T6), on the
 * profile clock: the lines, what the phone did and did not record, and what
 * TravStats knows of the day.
 *
 *   - `segments` — every stretch, cut at gaps, deleted spans and reported
 *     pauses, privacy-cut (`readSafe.ts`).
 *   - `coverage` — the whole day in consecutive pieces, each `recorded`,
 *     `phonePaused` (the phone reported it could not record), `deleted` (the
 *     owner deleted it) or `noData`. A privacy zone is never a state of its
 *     own: an hour inside one reads like any hour without a fix.
 *   - `context` — the day's flights (actual times where known, else the
 *     schedule), the trips spanning it, and the stretches within 300 m of the
 *     home place — read from the privacy-safe points only, so a home that is
 *     also a zone shows no time at home.
 */

export const DAY_POINT_CAP = 50_000;
export const HOME_RADIUS_KM = 0.3;

export type CoverageState = "recorded" | "noData" | "deleted" | "phonePaused";
export type DayCoverage = Array<Span & { state: CoverageState }>;
export type DayContext = Array<
  Span & { kind: "flight" | "trip" | "home"; id: string | null; label: string }
>;

export type TravTrackDay = {
  date: string;
  zone: string;
  segments: StoredPoint[][];
  coverage: DayCoverage;
  context: DayContext;
  pointCount: number;
  /** More points than one day answer carries; the rest is not shown. */
  truncated: boolean;
};

const RANK: Record<CoverageState, number> = { noData: 0, recorded: 1, phonePaused: 2, deleted: 3 };

/** The day in consecutive pieces, the strongest state winning where several meet. */
export function dayCoverage(
  window: Span,
  marks: ReadonlyArray<Span & { state: CoverageState }>
): DayCoverage {
  const inside = marks.filter((m) => m.untilMs > m.fromMs);
  const cuts = [
    ...new Set([
      window.fromMs,
      window.untilMs,
      ...inside
        .flatMap((m) => [m.fromMs, m.untilMs])
        .filter((t) => t > window.fromMs && t < window.untilMs),
    ]),
  ].sort((a, b) => a - b);
  const out: DayCoverage = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [fromMs, untilMs] = [cuts[k], cuts[k + 1]];
    const state = inside
      .filter((m) => m.fromMs <= fromMs && m.untilMs >= untilMs)
      .reduce<CoverageState>((best, m) => (RANK[m.state] > RANK[best] ? m.state : best), "noData");
    const last = out[out.length - 1];
    if (last && last.state === state) last.untilMs = untilMs;
    else out.push({ fromMs, untilMs, state });
  }
  return out;
}

function coverageOf(window: Span, read: SafeSpan): DayCoverage {
  return dayCoverage(window, [
    ...read.segments
      .filter((s) => s.length > 1)
      .map((s) => ({ fromMs: s[0][0], untilMs: s[s.length - 1][0], state: "recorded" as const })),
    ...read.paused.map((p) => ({ ...p, state: "phonePaused" as const })),
    ...read.deleted.map((d) => ({ ...d, state: "deleted" as const })),
  ]);
}

const overlapOf = (a: Span, b: Span): Span | null => {
  const fromMs = Math.max(a.fromMs, b.fromMs);
  const untilMs = Math.min(a.untilMs, b.untilMs);
  return untilMs > fromMs ? { fromMs, untilMs } : null;
};

/** An instant a clock can be read off: a real minute, never a day placeholder. */
const instantOf = (value: TimeValue | null): number | null =>
  value && value.precision === "minute" ? Date.parse(value.utc) : null;

async function flightContext(userId: string, window: Span): Promise<DayContext> {
  const wide = 2 * 86_400_000;
  const flights = await prisma.flight.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      OR: [
        {
          departureTime: {
            gte: new Date(window.fromMs - wide),
            lt: new Date(window.untilMs + wide),
          },
        },
        {
          arrivalTime: { gte: new Date(window.fromMs - wide), lt: new Date(window.untilMs + wide) },
        },
      ],
    },
    select: {
      id: true,
      flightNumber: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
      depTimezone: true,
      arrTimezone: true,
      depPrecision: true,
      arrPrecision: true,
      actualDeparture: true,
      actualArrival: true,
      runwayDepartureTime: true,
      runwayArrivalTime: true,
      onlineCheckInOpensAt: true,
      onlineCheckInZone: true,
    },
  });
  const out: DayContext = [];
  for (const f of flights) {
    const [dep, arr] = await Promise.all([
      getAirportTimezone(f.depIata ?? f.depIcao),
      getAirportTimezone(f.arrIata ?? f.arrIcao),
    ]);
    const times = flightTimes(f, { dep, arr });
    const from = instantOf(times.actualDeparture) ?? instantOf(times.departure);
    const until = instantOf(times.actualArrival) ?? instantOf(times.arrival);
    if (from === null || until === null || until <= from) continue;
    const span = overlapOf({ fromMs: from, untilMs: until }, window);
    if (!span) continue;
    const route = `${f.depIata ?? f.depIcao ?? "?"}–${f.arrIata ?? f.arrIcao ?? "?"}`;
    out.push({
      kind: "flight",
      id: f.id,
      label: [f.flightNumber, route].filter(Boolean).join(" "),
      ...span,
    });
  }
  return out;
}

async function tripContext(userId: string, window: Span): Promise<DayContext> {
  const wide = 2 * 86_400_000;
  const before = new Date(window.untilMs + wide);
  const after = new Date(window.fromMs - wide);
  const trips = await prisma.trip.findMany({
    where: {
      userId,
      OR: [
        { startDay: { lte: before }, endDay: { gte: after } },
        { startDay: null, startDate: { lte: before }, endDate: { gte: after } },
      ],
    },
    select: TRIP_RECORDING_TRIP_SELECT,
  });
  const out: DayContext = [];
  for (const trip of trips) {
    const span = await tripSpanInstants(userId, trip);
    const shown = span && overlapOf(span, window);
    if (shown) out.push({ kind: "trip", id: trip.id, label: trip.name, ...shown });
  }
  return out;
}

/** The stretches within `HOME_RADIUS_KM` of home, from the privacy-safe points only. */
function homeContext(home: { name: string; lat: number; lon: number }, read: SafeSpan): DayContext {
  const out: DayContext = [];
  for (const segment of read.segments) {
    let run: StoredPoint[] = [];
    const flush = () => {
      if (run.length > 1) {
        out.push({
          kind: "home",
          id: null,
          label: home.name,
          fromMs: run[0][0],
          untilMs: run[run.length - 1][0],
        });
      }
      run = [];
    };
    for (const p of segment) {
      if (haversineKm({ lat: p[1], lon: p[2] }, home) <= HOME_RADIUS_KM) run.push(p);
      else flush();
    }
    flush();
  }
  return out;
}

export async function travTrackDay(userId: string, date: string): Promise<TravTrackDay> {
  const { zone } = await profileZoneOf(userId);
  const window = {
    fromMs: midnightOf(date, zone).getTime(),
    untilMs: midnightOf(dayAfter(date), zone).getTime(),
  };
  const [read, settings] = await Promise.all([
    readSafeTravTrack(userId, window, DAY_POINT_CAP),
    prisma.userSettings.findUnique({ where: { userId }, select: { homePlace: true } }),
  ]);
  const home = homePlaceSchema.safeParse(settings?.homePlace);
  const [flights, trips] = await Promise.all([
    flightContext(userId, window),
    tripContext(userId, window),
  ]);
  const context = [
    ...flights,
    ...trips,
    ...(home.success ? homeContext(home.data, read) : []),
  ].sort((a, b) => a.fromMs - b.fromMs || a.kind.localeCompare(b.kind));
  return {
    date,
    zone,
    segments: read.segments,
    coverage: coverageOf(window, read),
    context,
    pointCount: read.segments.reduce((n, s) => n + s.length, 0),
    truncated: read.next !== null,
  };
}
