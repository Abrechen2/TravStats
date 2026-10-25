import {
  flightTrackColumnsFromParsed,
  pointsToParsedTrack,
} from "../flightDevice/flightTrackIngest";
import type { FlightTrackPoint } from "../../schemas/flightDevice";
import type { ZoneCircle } from "./classify";
import { privacyCutBy } from "./privacyCut";

/**
 * A flight line built from a provider's fixes (TravTrack plan T5, Codex
 * review): the privacy cut runs on the FIXES, before anything is measured.
 * Measuring first and cutting the simplified line afterwards let a fix inside
 * a zone that simplification had dropped live on in the distance, the vertex
 * count and the jitter count. Here such a fix never reaches the pipeline, and
 * where fixes were taken out (or a chord between two kept ones passes through
 * a zone) the line starts a new stretch, so no step across a zone is measured.
 *
 * The result still leaves through `cutFlightTrackWith`, which checks the
 * simplified line once more. Null when nothing outside the zones makes a line.
 */
export function zoneSafeFlightColumns(
  points: readonly FlightTrackPoint[],
  circles: readonly ZoneCircle[]
) {
  const pieces = privacyCutBy([[...points]], circles, (p): [number, number] => [p.lon, p.lat]);
  const kept = pieces.flat();
  if (kept.length < 2) return null;
  const segmentStarts: number[] = [];
  let at = 0;
  for (const piece of pieces) {
    segmentStarts.push(at);
    at += piece.length;
  }
  return flightTrackColumnsFromParsed({ ...pointsToParsedTrack(kept), segmentStarts });
}
