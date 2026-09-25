import {
  COVERAGE_REASON_RANK,
  cruiseLegsCoverage,
  type Coord,
  type LegCoverage,
  type LegCoverageReason,
  type LegCoverageStatus,
  type LegSlice,
} from "../trackCoverage/legCoverage";
import { readStoredTrack } from "../trackCoverage/storedTrack";

/**
 * Which recording, if any, a cruise leg takes its line and its kilometres
 * from — the ONE answer the distance path (`cruiseLegService.ts`, the
 * statistics) and the geometry path (`services/cruise/cruiseGeometry.ts`, the
 * map) both read. Two answers would let the map draw the recording while the
 * statistics count the sea route, and nothing on screen would look wrong.
 */

/** The columns coverage needs — selected, never the whole row. */
export const CRUISE_TRACK_COVERAGE_SELECT = {
  id: true,
  startedAt: true,
  geometry: true,
  segmentStarts: true,
  cumulativeKm: true,
} as const;

export interface CruiseTrackCoverageRow {
  id: string;
  startedAt: Date;
  geometry: unknown;
  segmentStarts: unknown;
  cumulativeKm: unknown;
}

export interface RecordedLeg {
  trackId: string;
  status: Exclude<LegCoverageStatus, "notCovered">;
  slice: LegSlice;
}

/** What the cruise page shows per leg. */
export interface LegTrackVerdict {
  /** The recording the verdict is about; null only when no recording reaches the leg at all. */
  trackId: string | null;
  status: LegCoverageStatus;
  reason: LegCoverageReason;
}

export interface ResolvedRecordedLegs {
  /** Per leg ordinal: the recording that wins it, or null. */
  recorded: Array<RecordedLeg | null>;
  /** Per leg ordinal; null when the cruise has no recordings. */
  verdicts: Array<LegTrackVerdict | null>;
}

/** Lower is better: a complete recording beats a bridged one. */
const USABLE_RANK: Record<RecordedLeg["status"], number> = { covered: 0, coveredWithGaps: 1 };

function better(candidate: RecordedLeg, current: RecordedLeg | null): boolean {
  if (current === null) return true;
  const byStatus = USABLE_RANK[candidate.status] - USABLE_RANK[current.status];
  if (byStatus !== 0) return byStatus < 0;
  // Strictly smaller: on a tie the earlier recording (tracks arrive sorted by
  // start) keeps the leg, so the choice does not flip between two reads.
  return candidate.slice.gapKm < current.slice.gapKm;
}

/**
 * `sequence` is the cruise's effective port sequence, the same list both
 * paths build through `buildEffectivePortSequence`; leg `i` runs from
 * `sequence[i]` to `sequence[i + 1]`.
 */
export function resolveRecordedLegs(
  sequence: ReadonlyArray<Coord>,
  tracks: ReadonlyArray<CruiseTrackCoverageRow>
): ResolvedRecordedLegs {
  const legs = sequence.slice(1).map((to, i) => ({ from: sequence[i], to }));
  const recorded: Array<RecordedLeg | null> = legs.map(() => null);
  const verdicts: Array<LegTrackVerdict | null> = legs.map(() => null);

  const ordered = [...tracks].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (const track of ordered) {
    const coverage: LegCoverage[] = cruiseLegsCoverage(readStoredTrack(track), legs);
    coverage.forEach((leg, i) => {
      if (leg.status !== "notCovered" && leg.slice !== null) {
        const candidate: RecordedLeg = { trackId: track.id, status: leg.status, slice: leg.slice };
        if (better(candidate, recorded[i])) {
          recorded[i] = candidate;
          verdicts[i] = { trackId: track.id, status: leg.status, reason: leg.reason };
        }
        return;
      }
      const current = verdicts[i];
      if (
        current === null ||
        COVERAGE_REASON_RANK[leg.reason] < COVERAGE_REASON_RANK[current.reason]
      ) {
        verdicts[i] = {
          trackId: leg.reason === "missesBoth" ? null : track.id,
          status: "notCovered",
          reason: leg.reason,
        };
      }
    });
  }
  return { recorded, verdicts };
}
