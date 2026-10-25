import { profileZoneOf } from "../../shared/time/profileZone";
import type { StoredPoint } from "../tripRecording/segments";
import { dayContext, type DayContextEntry } from "./dayContext";
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
 *   - `context` — what TravStats knows of the day, labelled from its own
 *     records (`dayContext.ts`, plan E10): every domain's entries, the trips,
 *     the time at home, the open TravTrack questions and the moving
 *     stretches no entry covers. This file keeps the geometry.
 */

export const DAY_POINT_CAP = 50_000;

export type CoverageState = "recorded" | "noData" | "deleted" | "phonePaused";
export type DayCoverage = Array<Span & { state: CoverageState }>;
export type DayContext = DayContextEntry[];

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

export async function travTrackDay(userId: string, date: string): Promise<TravTrackDay> {
  const { zone } = await profileZoneOf(userId);
  const window = {
    fromMs: midnightOf(date, zone).getTime(),
    untilMs: midnightOf(dayAfter(date), zone).getTime(),
  };
  const read = await readSafeTravTrack(userId, window, DAY_POINT_CAP);
  const context = await dayContext(userId, window, read);
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
