/**
 * The server's verdict on whether a recorded track covers a leg — tours and
 * cruises alike (`backend/src/services/trackCoverage/legCoverage.ts`). The
 * frontend only displays it; it never recomputes it (board item
 * `tour-track-coverage-server-side`).
 */
export type LegCoverageStatus = "covered" | "coveredWithGaps" | "notCovered";

export type LegCoverageReason =
  | "complete"
  | "bridgedGaps"
  | "recordingGap"
  | "tooManyGaps"
  | "missesFrom"
  | "missesTo"
  | "missesBoth";

export interface TrackVerdict {
  /** The recording the verdict is about; null when none reaches the leg at all. */
  trackId: string | null;
  status: LegCoverageStatus;
  reason: LegCoverageReason;
}

/** One leg of a tour section, as `GET …/legs/track-coverage` answers it. */
export interface TourLegTrackCoverage {
  legId: string;
  fromStopId: string;
  toStopId: string;
  /** Null when the section has no recordings. */
  verdict: TrackVerdict | null;
}
