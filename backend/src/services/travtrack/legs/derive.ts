import type { EntryWindow } from "../../locationEvidence/journeys/entryWindows";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";
import { inFlightBy } from "../months/values";
import type { StoredPoint } from "../../tripRecording/segments";
import { inPrivacyZone } from "../classify";
import type { SafeSpan } from "../readSafe";
import { classRuns, modeOfSteps, settleStill, stepClass } from "./autoMode";
import { entryModeOf, isBroadEntry, tightestWindow } from "./entries";
import { legFigures } from "./figures";
import { hasUsableMotion, modeFromSpeed } from "./speedMode";
import { findDwells, movingRuns } from "./stops";
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
    const classes = settleStill(sub.slice(1).map((p, i) => stepClass(sub[i], p, read.rowOf)));
    return classRuns(sub, cut.from, classes).map((r): Piece => {
      const fromMotion = modeOfSteps(sub, cut.from, classes, r.from, r.to);
      const runPoints = segment.slice(r.from, r.to + 2);
      // No motion class anywhere (the Companion sends none): fall back to the speed profile.
      const fromSpeed =
        fromMotion.mode === "unknown" && !hasUsableMotion(runPoints, read.rowOf)
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

export function deriveLegs(read: SafeSpan, inputs: LegInputs): { legs: Leg[]; stops: Stop[] } {
  const flights = inputs.windows
    .filter((w) => w.domain === "flight")
    .map((w): [number, number] => [w.fromMs, w.untilMs]);
  const inFlight = inFlightBy(flights, (p) => read.rowOf(p)?.purpose === "flight");
  const legs: Leg[] = [];
  const stops: Stop[] = [];
  read.segments.forEach((segment, segmentIndex) => {
    const dwells = findDwells(segment);
    for (const d of dwells) {
      const anchor = { lat: segment[d.from][1], lon: segment[d.from][2] };
      // Segments are privacy-cut, so this is a second lock, not the first.
      if (inPrivacyZone(anchor, read.circles)) continue;
      const span = { fromMs: segment[d.from][0], untilMs: segment[d.to][0] };
      stops.push({
        ...span,
        anchor,
        stayRef: stayFor(span, inputs.stays),
        place: placeFor(span, inputs.places ?? []),
      });
    }
    for (const run of movingRuns(segment.length, dwells)) {
      for (const piece of piecesOfRun(segment, run, inputs.windows, read)) {
        const points = segment.slice(piece.from, piece.to + 1);
        const span = { fromMs: points[0][0], untilMs: points[points.length - 1][0] };
        if (span.untilMs <= span.fromMs) continue;
        // Manual, then entry, then auto: the figures must follow the mode the leg ends up with.
        const manual = overrideFor(span, inputs.overrides);
        const mode = manual ? manual.mode : piece.mode;
        const figures = legFigures(points, read.rowOf, inFlight, mode !== "flight");
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
  legs.sort((a, b) => a.fromMs - b.fromMs);
  stops.sort((a, b) => a.fromMs - b.fromMs);
  return { legs, stops };
}
