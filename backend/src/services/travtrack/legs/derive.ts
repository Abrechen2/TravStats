import type { EntryWindow } from "../../locationEvidence/journeys/entryWindows";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import { inFlightBy } from "../months/values";
import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM, inPrivacyZone } from "../classify";
import type { SafeSpan } from "../readSafe";
import { classRuns, modeOfSteps, settleStill, stepClass } from "./autoMode";
import { entryModeOf, isBroadEntry, tightestWindow } from "./entries";
import { legFigures } from "./figures";
import { hasUsableMotion, modeFromSpeed } from "./speedMode";
import { findFoldRuns, type FoldContext, type FoldRun } from "./fold";
import { STOP_MS } from "../dayMovement";
import { RECORDING_GAP_MS } from "../../tripRecording/segments";
import {
  badVertexIn,
  findDwells,
  isBadVertex,
  MAX_DRAWN_ACCURACY_M,
  movingRuns,
  type Dwell,
} from "./stops";
import type {
  Leg,
  LegMode,
  LegOverride,
  Stop,
  StayCandidate,
  StopPlace,
  StopPlaceRow,
} from "./types";

/** A stretch shorter than this along its way is a shuffle between two stops, no leg. */
export const MIN_LEG_M = 100;

export type LegInputs = {
  /** Every movement-holding entry window of the day (flight, rail, bus, ferry, cruise, rental, roadtrip). */
  windows: readonly EntryWindow[];
  overrides: readonly LegOverride[];
  stays: readonly StayCandidate[];
  /** Names the owner accepted for stops; optional so the pure derivation needs none. */
  places?: readonly StopPlaceRow[];
  /** Fixed places and lodging bookings a run of fixes folds into; none folds nothing. */
  fold?: FoldContext;
};

type Piece = {
  from: number;
  to: number;
  entry: EntryWindow | null;
  mode: LegMode;
  source: "auto" | "entry";
  confidence: "high" | "low";
};

/** Steps `first..last` (step k joins vertex k and k + 1) cut where the covering narrow entry changes. */
function entryCuts(
  segment: readonly StoredPoint[],
  from: number,
  to: number,
  narrow: readonly EntryWindow[]
): Array<{ from: number; to: number; entry: EntryWindow | null }> {
  const out: Array<{ from: number; to: number; entry: EntryWindow | null }> = [];
  for (let k = from; k < to; k++) {
    const mid = (segment[k][0] + segment[k + 1][0]) / 2;
    const entry = tightestWindow(mid, narrow);
    const last = out[out.length - 1];
    if (last && last.entry === entry) last.to = k + 1;
    else out.push({ from: k, to: k + 1, entry });
  }
  return out;
}

function piecesOfRun(
  segment: readonly StoredPoint[],
  run: { from: number; to: number },
  windows: readonly EntryWindow[],
  read: SafeSpan
): Piece[] {
  const narrow = windows.filter((w) => !isBroadEntry(w.domain));
  const broad = windows.filter((w) => isBroadEntry(w.domain));
  return entryCuts(segment, run.from, run.to, narrow).flatMap((cut): Piece[] => {
    if (cut.entry) {
      return [
        {
          ...cut,
          entry: cut.entry,
          mode: entryModeOf(cut.entry.domain),
          source: "entry",
          confidence: "high",
        },
      ];
    }
    const sub = segment.slice(cut.from, cut.to + 1);
    // A day recorded only with coarse fixes: its line is drawn, but no motion class or pace can be
    // read off fixes a kilometre wide, so the mode stays unknown (low) rather than invented.
    const coarseOnly =
      segment.some((p) => p[3] !== null && p[3] > MAX_DRAWN_ACCURACY_M) &&
      segment.every(isBadVertex);
    const classes: LegMode[] = coarseOnly
      ? sub.slice(1).map(() => "unknown")
      : settleStill(sub.slice(1).map((p, i) => stepClass(sub[i], p, read.rowOf)));
    return classRuns(sub, cut.from, classes).map((r): Piece => {
      const fromMotion = modeOfSteps(sub, cut.from, classes, r.from, r.to);
      const runPoints = segment.slice(r.from, r.to + 2);
      // No motion class anywhere (the Companion sends none): fall back to the speed profile.
      const fromSpeed =
        !coarseOnly && fromMotion.mode === "unknown" && !hasUsableMotion(runPoints, read.rowOf)
          ? modeFromSpeed(runPoints, read.rowOf)
          : null;
      const auto = fromSpeed ?? fromMotion;
      const mid = (segment[r.from][0] + segment[r.to + 1][0]) / 2;
      const wide = tightestWindow(mid, broad);
      // A rental or roadtrip window spans days of walking too: it names the
      // mode only where the phone does not clearly say it was a person on foot.
      const onFoot = auto.confidence === "high" && ["walk", "run", "cycle"].includes(auto.mode);
      if (wide && !onFoot) {
        return {
          from: r.from,
          to: r.to + 1,
          entry: wide,
          mode: entryModeOf(wide.domain),
          source: "entry",
          confidence: "high",
        };
      }
      return {
        from: r.from,
        to: r.to + 1,
        entry: null,
        mode: auto.mode,
        source: "auto",
        confidence: auto.confidence,
      };
    });
  });
}

function overrideFor(
  leg: { fromMs: number; untilMs: number },
  overrides: readonly LegOverride[]
): LegOverride | null {
  const covering = overrides.filter((o) => overlapShare(leg, o) > 0.5);
  return covering.reduce<LegOverride | null>(
    (best, o) => (best === null || o.updatedAtMs > best.updatedAtMs ? o : best),
    null
  );
}

function stayFor(span: { fromMs: number; untilMs: number }, stays: readonly StayCandidate[]) {
  let best: StayCandidate | null = null;
  let bestShare = 0;
  for (const s of stays) {
    const share = overlapShare(span, s);
    if (share >= 0.5 && share > bestShare) [best, bestShare] = [s, share];
  }
  return best ? { id: best.id, status: best.status } : null;
}

/** The newest accepted name whose span covers the stop by more than half. */
function placeFor(
  span: { fromMs: number; untilMs: number },
  places: readonly StopPlaceRow[]
): StopPlace | null {
  const best = places
    .filter((p) => overlapShare(span, p) > 0.5)
    .reduce<StopPlaceRow | null>(
      (b, p) => (b === null || p.updatedAtMs > b.updatedAtMs ? p : b),
      null
    );
  return best ? { name: best.name, lat: best.lat, lon: best.lon, source: "accepted" } : null;
}

type FoldedDwell = Dwell & { fold?: FoldRun };

const overlaps = (a: Dwell, b: Dwell) => a.from <= b.to && b.from <= a.to;

/** A dwell minus the folds over it: the pieces still standing for at least `STOP_MS`. */
function outsideFolds(
  segment: readonly StoredPoint[],
  dwell: Dwell,
  folds: readonly FoldRun[]
): Dwell[] {
  let pieces: Dwell[] = [dwell];
  for (const f of folds.filter((f) => overlaps(dwell, f))) {
    pieces = pieces.flatMap((p) =>
      overlaps(p, f)
        ? [
            { from: p.from, to: f.from - 1 },
            { from: f.to + 1, to: p.to },
          ]
        : [p]
    );
  }
  return pieces.filter((p) => p.to > p.from && segment[p.to][0] - segment[p.from][0] >= STOP_MS);
}

/** The natural dwells, with every one a fold run covers replaced by that run. */
function dwellsWithFolds(
  segment: readonly StoredPoint[],
  fold: FoldContext | undefined,
  read: SafeSpan
): FoldedDwell[] {
  const natural = findDwells(segment);
  if (!fold) return natural;
  // A circle centred inside a privacy zone would put a stop on the zone: it folds nothing.
  const clear = (c: { lat: number; lon: number }) => !inPrivacyZone(c, read.circles);
  const folds = findFoldRuns(
    segment,
    { places: fold.places.filter(clear), lodgings: fold.lodgings.filter(clear) },
    // Coarse fixes are neutral to a fold even in a stretch that holds nothing finer: a
    // kilometre-wide reading proves nothing about a 100 m circle.
    isBadVertex
  );
  // What a fold leaves of a natural dwell (the stretch before and after it) is still a dwell if long enough.
  const kept = natural.flatMap((d) => outsideFolds(segment, d, folds));
  return [...kept, ...folds.map((f): FoldedDwell => ({ from: f.from, to: f.to, fold: f }))].sort(
    (a, b) => a.from - b.from
  );
}

function foldedStop(
  run: FoldRun,
  accepted: StopPlace | null
): Pick<Stop, "anchor" | "place" | "folded"> {
  const t = run.target;
  const at = t.source === "fixed" ? t.place : t.lodging;
  const named: StopPlace =
    t.source === "fixed"
      ? { name: t.place.name, lat: at.lat, lon: at.lon, source: "fixed", placeId: t.place.id }
      : {
          name: t.lodging.name,
          lat: at.lat,
          lon: at.lon,
          source: "lodging",
          lodgingStayId: t.lodging.stayId,
        };
  // The name the owner accepted outranks a fixed place, which outranks a lodging.
  return {
    anchor: { lat: at.lat, lon: at.lon },
    place: accepted ?? named,
    folded: { fixCount: run.fixCount },
  };
}

/** A privacy zone this close may have cut a visit out of a silence, or a name may point into it. */
const ZONE_NEAR_M = 500;

/** Whether a point lies in a zone or within `ZONE_NEAR_M` of one. */
function near(
  p: { lat: number | null; lon: number | null },
  circles: SafeSpan["circles"]
): boolean {
  if (p.lat === null || p.lon === null) return false;
  const at = { lat: p.lat, lon: p.lon };
  return circles.some((c) => distanceM(at, c) <= c.radiusM + ZONE_NEAR_M);
}

function stopOf(
  segment: readonly StoredPoint[],
  d: FoldedDwell,
  read: SafeSpan,
  inputs: LegInputs
): Stop | null {
  const span = { fromMs: segment[d.from][0], untilMs: segment[d.to][0] };
  const accepted = placeFor(span, inputs.places ?? []);
  const shown = d.fold
    ? foldedStop(d.fold, accepted)
    : {
        anchor: { lat: segment[d.from][1], lon: segment[d.from][2] },
        place: accepted,
        folded: null,
      };
  // Segments are privacy-cut, so this is a second lock, not the first.
  if (inPrivacyZone(shown.anchor, read.circles)) return null;
  // A name whose position lies in or beside a zone would point into it; a name without a
  // position is judged by where the stop is. A fold target that close gives way to the
  // fixes actually observed.
  const anchorNear = near(shown.anchor, read.circles);
  const hide = shown.place !== null && (anchorNear || near(shown.place, read.circles));
  if (hide && shown.folded) {
    const observed = { lat: segment[d.from][1], lon: segment[d.from][2] };
    if (inPrivacyZone(observed, read.circles)) return null;
    return {
      ...span,
      anchor: observed,
      place: null,
      folded: null,
      stayRef: stayFor(span, inputs.stays),
    };
  }
  const place = hide ? null : shown.place;
  return { ...span, ...shown, place, stayRef: stayFor(span, inputs.stays) };
}

/**
 * A phone at rest sends few fixes, and a silence of more than `RECORDING_GAP_MS` cuts the
 * recording into stretches too short to hold a dwell each: a day spent in one spot was
 * "a single fix, a gap, a single fix" and produced no stop at all. The stretches are
 * joined here, for stops only, across a clock gap the phone did not announce (no pause, no
 * deleted range inside it); a dwell that reaches over a join is the stop. Whether the
 * phone left and came back unseen is not knowable; both ends lie within `STEP_M` of the
 * dwell's first fix, which is the same evidence a dense dwell rests on.
 */
function bridgedStops(
  read: SafeSpan,
  inputs: LegInputs
): Array<{ stop: Stop; chain: StoredPoint[][] }> {
  const deviceOf = (seg: readonly StoredPoint[]) => read.rowOf(seg[0])?.deviceId ?? "";
  const nearZone = (p: StoredPoint) =>
    read.circles.some((c) => distanceM({ lat: p[1], lon: p[2] }, c) <= c.radiusM + ZONE_NEAR_M);
  const ordered = read.segments.filter((s) => s.length > 0).sort((a, b) => a[0][0] - b[0][0]);
  const chains: StoredPoint[][][] = [];
  const open = new Map<string, StoredPoint[][]>();
  for (const seg of ordered) {
    const device = deviceOf(seg);
    const chain = open.get(device);
    const prev = chain?.[chain.length - 1];
    const tail = prev?.[prev.length - 1];
    const joins =
      chain !== undefined &&
      tail !== undefined &&
      seg[0][0] - tail[0] > RECORDING_GAP_MS &&
      !(read.removedAtMs ?? []).some((t) => t > tail[0] && t < seg[0][0]) &&
      !nearZone(tail) &&
      !nearZone(seg[0]) &&
      !read.deleted.some((b) => b.fromMs < seg[0][0] && b.untilMs > tail[0]) &&
      !read.paused.some(
        (b) => b.deviceId === device && b.fromMs < seg[0][0] && b.untilMs > tail[0]
      );
    if (joins) chain.push(seg);
    else {
      const fresh = [seg];
      chains.push(fresh);
      open.set(device, fresh);
    }
  }
  const out: Array<{ stop: Stop; chain: StoredPoint[][] }> = [];
  for (const chain of chains.filter((c) => c.length > 1)) {
    const joined = chain.flat();
    const bounds = chain.slice(1).map((s) => s[0][0]);
    for (const d of dwellsWithFolds(joined, inputs.fold, read)) {
      const first = joined[d.from][0];
      const last = joined[d.to][0];
      if (!bounds.some((b) => first < b && b <= last)) continue;
      const stop = stopOf(joined, d, read, inputs);
      if (stop && !nearZone(joined[d.from]) && !near(stop.anchor, read.circles))
        out.push({ stop, chain });
    }
  }
  return out;
}

export function deriveLegs(read: SafeSpan, inputs: LegInputs): { legs: Leg[]; stops: Stop[] } {
  const flights = inputs.windows
    .filter((w) => w.domain === "flight")
    .map((w): [number, number] => [w.fromMs, w.untilMs]);
  const inFlight = inFlightBy(flights, (p) => read.rowOf(p)?.purpose === "flight");
  const legs: Leg[] = [];
  const stops: Stop[] = [];
  const origin = new Map<Stop, StoredPoint[]>();
  const replaced = new Set<Stop>();
  read.segments.forEach((segment, segmentIndex) => {
    const dwells = dwellsWithFolds(segment, inputs.fold, read);
    for (const d of dwells) {
      const stop = stopOf(segment, d, read, inputs);
      if (stop) {
        stops.push(stop);
        origin.set(stop, segment);
      }
    }
    for (const run of movingRuns(segment.length, dwells)) {
      for (const piece of piecesOfRun(segment, run, inputs.windows, read)) {
        const points = segment.slice(piece.from, piece.to + 1);
        const span = { fromMs: points[0][0], untilMs: points[points.length - 1][0] };
        if (span.untilMs <= span.fromMs) continue;
        // Manual, then entry, then auto: the figures must follow the mode the leg ends up with.
        const manual = overrideFor(span, inputs.overrides);
        const mode = manual ? manual.mode : piece.mode;
        const figures = legFigures(
          points,
          read.rowOf,
          inFlight,
          mode !== "flight",
          badVertexIn(segment)
        );
        if (figures.distanceM < MIN_LEG_M) continue;
        legs.push({
          id: `${span.fromMs}-${span.untilMs}`,
          ...span,
          mode,
          modeSource: manual ? "manual" : piece.source,
          confidence: manual ? "high" : piece.confidence,
          entryRef:
            !manual && piece.entry ? { domain: piece.entry.domain, id: piece.entry.id } : null,
          durationMs: span.untilMs - span.fromMs,
          ...figures,
          ranges: [{ segment: segmentIndex, from: piece.from, to: piece.to }],
        });
      }
    }
  });
  // A bridged stop replaces the stops of ITS OWN chain's stretches (same device, same checks)
  // and spans what they covered; a stop from anywhere else is never merged into it.
  const bridged = bridgedStops(read, inputs).map(({ stop: b, chain }) => {
    const own = [...origin].filter(
      ([s, seg]) => chain.includes(seg) && s.fromMs < b.untilMs && b.fromMs < s.untilMs
    );
    own.forEach(([s]) => replaced.add(s));
    return {
      ...b,
      fromMs: Math.min(b.fromMs, ...own.map(([s]) => s.fromMs)),
      untilMs: Math.max(b.untilMs, ...own.map(([s]) => s.untilMs)),
    };
  });
  const standing = stops.filter((s) => !replaced.has(s));
  stops.length = 0;
  stops.push(...standing, ...bridged);
  legs.sort((a, b) => a.fromMs - b.fromMs);
  stops.sort((a, b) => a.fromMs - b.fromMs);
  return { legs, stops };
}
