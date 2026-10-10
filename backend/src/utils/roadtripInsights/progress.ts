/**
 * How far a roadtrip has got (forgejo#179): its kilometres split by where each
 * stretch stands on the timeline — driven, today's, planned, or undated on a
 * roadtrip still under way — and what every kilometre was measured on.
 *
 * The bucket of a stretch has ONE home, `stretchBucket`; the statistics
 * (`./index.ts`) and the roadtrip page (`GET /roadtrips/:id`, `progress`) both
 * ask it, so the page cannot call a stretch driven that the statistics still
 * call planned. The web page once showed "Gefahren 254 km" on day 1 of 3, with
 * the only leg still a day ahead.
 */
import {
  isRecorded,
  legPhase,
  roadtripPhase,
  type RoadtripPhase,
  type TimelineStation,
} from "../../shared/tour/roadtripTimeline";
import { segmentsOf, type SegmentLeg, type SegmentStation } from "./segments";
import type { PhaseKm } from "./types";

export type PhaseBucket = keyof PhaseKm;

/** Where a stretch between two stations stands, by the timeline rule. */
export function stretchBucket(
  from: TimelineStation,
  to: TimelineStation,
  trip: RoadtripPhase,
  now: Date
): PhaseBucket {
  const phase = legPhase(from, to, now);
  if (isRecorded(phase, trip)) return "recorded";
  if (phase === "current") return "current";
  if (phase === "planned") return "planned";
  return "unplaced";
}

export interface RoadtripProgress {
  /** The roadtrip as a whole: past, current, planned or undated. */
  phase: RoadtripPhase;
  /** Road legs only — what the vehicle drove — by bucket. */
  roadKm: PhaseKm;
  /**
   * Every road kilometre by what it was measured on: `straight` (a straight
   * line between stations), `drawn` (drawn by hand), `routed` (a routing
   * provider's road), `track` (a recorded GPS track). The basis of the figure,
   * whatever its date.
   */
  roadKmBySource: Record<string, number>;
  /** The same, for the driven (`recorded`) kilometres only. */
  recordedRoadKmBySource: Record<string, number>;
}

const ROAD = "road";

export function roadtripProgress<
  S extends SegmentStation & TimelineStation,
  L extends SegmentLeg & { mode: string; source: string },
>(stations: readonly S[], legs: readonly L[], now: Date): RoadtripProgress {
  const real = stations.filter((s) => !s.viaPoint);
  const phase = roadtripPhase(real, now);
  const roadKm: PhaseKm = { recorded: 0, current: 0, planned: 0, unplaced: 0 };
  const roadKmBySource: Record<string, number> = {};
  const recordedRoadKmBySource: Record<string, number> = {};
  for (const seg of segmentsOf(stations, legs)) {
    const bucket = stretchBucket(seg.from, seg.to, phase, now);
    for (const leg of seg.legs) {
      if (leg.mode !== ROAD) continue;
      roadKm[bucket] += leg.distanceKm;
      roadKmBySource[leg.source] = (roadKmBySource[leg.source] ?? 0) + leg.distanceKm;
      if (bucket === "recorded") {
        recordedRoadKmBySource[leg.source] =
          (recordedRoadKmBySource[leg.source] ?? 0) + leg.distanceKm;
      }
    }
  }
  return { phase, roadKm, roadKmBySource, recordedRoadKmBySource };
}
