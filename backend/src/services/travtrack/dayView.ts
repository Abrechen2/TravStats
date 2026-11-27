import { daySourceExtras, ensureDayResolved, type DaySourceExtras } from "./bestSource/dayExtras";
import { dayCleanup, type DayCleanup } from "./cleanup/dayCleanup";
import { profileZoneOf } from "../../shared/time/profileZone";
import type { StoredPoint } from "../tripRecording/segments";
import { dayContext, type DayContextEntry } from "./dayContext";
import { deriveDay } from "./dayDerivation";
import { explainingEntries, fillWithEntries, type CoverageEntryRef } from "./dayEntryCoverage";
import type { Leg, Stop } from "./legs";
import { dayAfter, midnightOf } from "./range";
import type { SafeSpan, Span } from "./readSafe";
import {
  explainStationary,
  type HomeSuggestion,
  type StationaryPiece,
} from "./silence/stationaryCoverage";
import { badVertexIn } from "./legs/stops";

/**
 * One day of the account's TravTrack history (TravTrack plan T6), on the
 * profile clock: the lines, what the phone did and did not record, and what
 * TravStats knows of the day.
 *
 *   - `segments` — every stretch, cut at gaps, deleted spans and reported
 *     pauses, privacy-cut (`readSafe.ts`); `pointIds` names each vertex's
 *     stored point, aligned with them.
 *   - `coverage` — the whole day in consecutive pieces, each `recorded`,
 *     `phonePaused` (the phone reported it could not record), `deleted` (the
 *     owner deleted it) or `noData`. A privacy zone is never a state of its
 *     own: an hour inside one reads like any hour without a fix.
 *     A `noData` stretch a logbook entry covers is `entry` for that part, with
 *     the entry's `{domain, id}` (`dayEntryCoverage.ts`); it adds no point and no km.
 *   - `legs` and `stops` — the day as journeys and dwells (`legs/`, spec
 *     2026-11-03-travtrack-legs), cut from the same privacy-safe segments;
 *     `ranges` index into `segments`.
 *   - `pointDetails` — the phone's speed, altitude and movement class of each
 *     vertex, aligned with `segments`, for the inspector.
 *   - `context` — what TravStats knows of the day, labelled from its own
 *     records (`dayContext.ts`, plan E10): every domain's entries, the trips,
 *     the time at home, the open TravTrack questions and the moving
 *     stretches no entry covers. This file keeps the geometry.
 */

export type CoverageState =
  "recorded" | "noData" | "deleted" | "phonePaused" | "entry" | "stationary";
/** An `entry` piece names the logbook entry that explains the silence in `entry`. */
export type DayCoverage = Array<
  Span & {
    state: CoverageState;
    entry?: CoverageEntryRef;
    /** On `stationary` only: the known place both ends of the silence lie in (inferred, no points). */
    place?: StationaryPiece["place"];
    /** On `noData` only: why the silence was not explained by standing still. */
    why?: StationaryPiece["why"];
  }
>;
export type PointDetail = {
  speedMps: number | null;
  altitudeM: number | null;
  motion: string | null;
};

/** The readings of every vertex of `segments`, aligned with them. */
export function pointDetailsOf(
  segments: readonly StoredPoint[][],
  rowOf: SafeSpan["rowOf"]
): PointDetail[][] {
  return segments.map((s) =>
    s.map((p) => {
      const row = rowOf(p);
      return {
        speedMps: row?.speedMps ?? null,
        altitudeM: row?.altitudeM ?? null,
        motion: row?.motion ?? null,
      };
    })
  );
}

export type DayContext = DayContextEntry[];

export type TravTrackDay = {
  date: string;
  zone: string;
  segments: StoredPoint[][];
  /** The stored point of each vertex, aligned with `segments` (plan T5.3): what a single delete names. */
  pointIds: string[][];
  /** The phone's own readings of each vertex, aligned with `segments` (null where it gave none). */
  pointDetails: PointDetail[][];
  coverage: DayCoverage;
  context: DayContext;
  /**
   * No home is known and a silence began and ended at one spot: "Ist das dein Zuhause?" offers
   * it, linking to the home setting. Null when nothing like that happened.
   */
  homeSuggestion: HomeSuggestion | null;
  legs: Leg[];
  stops: Stop[];
  /**
   * The optional cleanup (rc46 extras C): the smoothing state, the smoothed stretches for drawing
   * (labelled, never replacing `segments`) and the road-matched stretches with their undo ids.
   */
  cleanup: DayCleanup;
  pointCount: number;
  /** More points than one day answer carries; the rest is not shown. */
  truncated: boolean;
  /**
   * Why a day may show fewer points than the phone stored: fixes the privacy cut hid and fixes
   * left out as implausible (coarse, null island). Counts only, never a position. Together with
   * `pointCount` they tell "nothing recorded" from "recorded but not drawn".
   */
  omitted: { privacyZone: number; implausible: number; sourceExcluded: number };
} & DaySourceExtras;

const RANK: Record<CoverageState, number> = {
  noData: 0,
  entry: 0,
  stationary: 0,
  recorded: 1,
  phonePaused: 2,
  deleted: 3,
};

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

function coverageOf(window: Span, read: SafeSpan, stops: readonly Stop[]): DayCoverage {
  return dayCoverage(window, [
    // A stay the phone did not interrupt is covered, though it sent nothing while it lasted;
    // a pause or a deletion still outranks it.
    ...stops.map((s) => ({ fromMs: s.fromMs, untilMs: s.untilMs, state: "recorded" as const })),
    ...read.segments
      .filter((s) => s.length > 1)
      .map((s) => ({ fromMs: s[0][0], untilMs: s[s.length - 1][0], state: "recorded" as const })),
    ...read.paused.map((p) => ({ ...p, state: "phonePaused" as const })),
    ...read.deleted.map((d) => ({ ...d, state: "deleted" as const })),
  ]);
}

/** The day's labels for the silences spent standing at a known place. */
function stationaryContext(coverage: readonly StationaryPiece[]): DayContextEntry[] {
  return coverage.flatMap((c) =>
    c.state === "stationary" && c.place
      ? [
          {
            kind: "stationary" as const,
            id: c.place.id,
            label: c.place.kind === "home" ? "" : c.place.name,
            href: null,
            anchor: { lat: c.place.lat, lon: c.place.lon },
            unlabelled: false,
            inferred: true as const,
            fromMs: c.fromMs,
            untilMs: c.untilMs,
          },
        ]
      : []
  );
}

const vertices = (r: Pick<SafeSpan, "segments">) => r.segments.reduce((n, s) => n + s.length, 0);

export async function travTrackDay(
  userId: string,
  date: string,
  options: { includeImplausible?: boolean } = {}
): Promise<TravTrackDay> {
  const { zone } = await profileZoneOf(userId);
  const window = {
    fromMs: midnightOf(date, zone).getTime(),
    untilMs: midnightOf(dayAfter(date), zone).getTime(),
  };
  await ensureDayResolved(userId, date);
  const { raw, read, legs, stops } = await deriveDay(
    userId,
    window,
    options.includeImplausible === true
  );
  const dayContextEntries = await dayContext(userId, window, read, stops);
  // A silence a logbook entry covers reads as that entry; one spent standing at a known place as
  // that place (inferred, never points); everything else stays "no data" and says why.
  const withEntries = fillWithEntries(
    coverageOf(window, read, stops),
    explainingEntries(dayContextEntries)
  );
  const stationary = await explainStationary(userId, window, date, withEntries);
  const extras = await daySourceExtras(userId, date, read);
  const cleanup = await dayCleanup(userId, window, read, extras.sources);
  return {
    ...extras,
    date,
    zone,
    segments: read.segments,
    pointIds: read.segments.map((s) => s.map((p) => read.rowOf(p)?.id ?? "")),
    pointDetails: pointDetailsOf(read.segments, read.rowOf),
    coverage: stationary.coverage as DayCoverage,
    context: [...dayContextEntries, ...stationaryContext(stationary.coverage)].sort(
      (a, b) => a.fromMs - b.fromMs || a.kind.localeCompare(b.kind)
    ),
    homeSuggestion: stationary.homeSuggestion,
    legs,
    stops,
    cleanup,
    pointCount: vertices(read),
    truncated: raw.next !== null,
    omitted: {
      privacyZone: Math.max(0, (raw.storedCount ?? vertices(raw)) - vertices(raw)),
      // The verdict drawn fixes use (`badVertexIn`), not a difference of counts: dropping a fix
      // may let the privacy cut take a good one with it, and that is no implausible fix.
      implausible: options.includeImplausible
        ? 0
        : raw.segments.reduce((n, s) => n + s.filter(badVertexIn(s)).length, 0),
      sourceExcluded: raw.sourceExcluded ?? 0,
    },
  };
}
