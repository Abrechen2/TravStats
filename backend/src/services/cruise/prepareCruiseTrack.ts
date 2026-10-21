import { CRUISE_TRACK_GAP_KM } from "../trackCoverage/legCoverage";
import { splitAtLongSteps } from "../trackCoverage/splitAtLongSteps";
import { filterParsedTrack } from "../tracks/recordingJitter";
import type { ParsedTrack } from "../tour/tracks/parseGpx";
import type { IngestedTrack } from "../tour/tracks/ingestTrack";
import { ingestedTrackColumns } from "../tour/tracks/trackRow";

/**
 * A cruise recording made ready to measure, for every way one arrives — a
 * file, a Dawarich pull, the re-measure job. Jitter out first (forgejo#319 —
 * a phone on a moored ship draws a cloud, and a teleport would otherwise read
 * as two holes), then the hours at sea without signal marked as holes.
 */
export function prepareCruiseTrack(parsed: ParsedTrack): ParsedTrack {
  return splitAtLongSteps(filterParsedTrack(parsed, "ship"), CRUISE_TRACK_GAP_KM);
}

/**
 * The columns a cruise recording keeps. Climb and moving time are dropped on
 * purpose: at sea they measure a ship's swell and a ship's clock.
 */
export function cruiseTrackColumns(ingested: IngestedTrack) {
  const {
    startedAt,
    endedAt,
    geometry,
    segmentStarts,
    cumulativeKm,
    pointCount,
    jitterDropped,
    distanceKm,
  } = ingestedTrackColumns(ingested);
  return {
    startedAt,
    endedAt,
    geometry,
    segmentStarts,
    cumulativeKm,
    pointCount,
    jitterDropped,
    distanceKm,
  };
}
