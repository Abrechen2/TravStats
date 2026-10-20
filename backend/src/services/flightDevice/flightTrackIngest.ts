import { ingestTrack } from "../tour/tracks/ingestTrack";
import { ingestedTrackColumns } from "../tour/tracks/trackRow";
import { splitAtLongSteps } from "../trackCoverage/splitAtLongSteps";
import type { ParsedTrack } from "../tour/tracks/parseGpx";
import type { FlightTrackPoint } from "../../schemas/flightDevice";

/**
 * The floor of the hole threshold for a recording made in a cabin. A phone at
 * a window seat holds a fix; one in an aisle seat or a pocket loses it for an
 * hour at a time. At cruise speed 50 km is three to four minutes of flight, so
 * a longer step between two fixes is a stretch nothing recorded — kept as a
 * gap in the line and out of the measured distance, the rule every stored
 * track follows (`splitAtLongSteps`, AUD-033).
 */
export const FLIGHT_TRACK_GAP_KM = 50;

/** The phone's points as the shared track pipeline reads them. */
export function pointsToParsedTrack(points: readonly FlightTrackPoint[]): ParsedTrack {
  const hasAltitude = points.some((p) => p.alt !== undefined);
  return {
    points: points.map((p): [number, number] => [p.lon, p.lat]),
    segmentStarts: [0],
    startedAt: new Date(points[0].t),
    endedAt: new Date(points[points.length - 1].t),
    name: null,
    elevations: hasAltitude ? points.map((p) => p.alt ?? null) : undefined,
    times: points.map((p) => p.t),
  };
}

/**
 * The columns a flight recording keeps: `CruiseTrack`'s plus the altitude
 * profile. Climb and moving time are dropped — an aircraft's climb is not the
 * passenger's effort, and its "moving time" is the block time already stored
 * on the flight. Null when the points cannot make a line (fewer than two
 * distinct positions after validation).
 */
export function flightTrackColumns(points: readonly FlightTrackPoint[]) {
  return flightTrackColumnsFromParsed(pointsToParsedTrack(points));
}

/**
 * The same columns from any parsed recording — the phone's points or a file
 * (forgejo#312), so both sources go through ONE pipeline: holes marked first,
 * then measured on the raw points, then simplified. Null without a time window
 * or without two positions.
 */
export function flightTrackColumnsFromParsed(parsed: ParsedTrack) {
  const ingested = ingestTrack(splitAtLongSteps(parsed, FLIGHT_TRACK_GAP_KM));
  if (!ingested) return null;
  const {
    startedAt,
    endedAt,
    geometry,
    segmentStarts,
    cumulativeKm,
    pointCount,
    distanceKm,
    elevations,
  } = ingestedTrackColumns(ingested);
  return {
    startedAt,
    endedAt,
    geometry,
    segmentStarts,
    cumulativeKm,
    pointCount,
    distanceKm,
    elevations,
  };
}

export type FlightTrackColumns = NonNullable<ReturnType<typeof flightTrackColumnsFromParsed>>;
