import { createHash } from "crypto";

import { looksLikeKml, parseKml } from "../tour/tracks/parseKml";
import { detectTrackFormat, parseTrackFile } from "../tour/tracks/parseTrackFile";
import type { ParsedTrack } from "../tour/tracks/parseGpx";
import type { FlightTrackSource } from "../../schemas/flightDevice";

/**
 * A recorded flight uploaded as a FILE on the flight page (forgejo#312).
 *
 * KML is read here and not in the shared `parseTrackFile`: it is what flight
 * trackers export (FlightAware, Flightradar24), and offering it on the tour and
 * cruise uploads too would change their accepted formats and their error copy
 * — a decision for those features, not a side effect of this one. GPX, TCX and
 * FIT come through the shared reader unchanged.
 */

export type FlightTrackFileFormat = Exclude<FlightTrackSource, "companion">;

export interface FlightTrackFile {
  format: FlightTrackFileFormat;
  track: ParsedTrack;
}

/** The bytes decide, as in `detectTrackFormat`; the name only breaks a tie. */
export async function readFlightTrackFile(
  buffer: Buffer,
  fileName?: string
): Promise<FlightTrackFile | null> {
  const head = buffer.toString("utf-8", 0, Math.min(buffer.length, 4096));
  const extension = fileName?.toLowerCase().split(".").pop();
  const isKml = looksLikeKml(head) || (detectTrackFormat(buffer) === null && extension === "kml");
  if (isKml) {
    const track = parseKml(buffer.toString("utf-8"));
    return track ? { format: "kml", track } : null;
  }
  return parseTrackFile(buffer, fileName);
}

/**
 * The upload id a FILE is stored under: its content hash. Uploading the same
 * bytes again — a double click, a retry after a dropped answer — is then the
 * replay the phone's outbox already gets, answered with the stored row,
 * instead of a 409 against the user's own first attempt.
 */
export function fileUploadId(buffer: Buffer): string {
  return `file:${createHash("sha256").update(buffer).digest("hex")}`;
}

export type PlacedTrack = ParsedTrack & { startedAt: Date; endedAt: Date };

/**
 * A recording without times (a drawn route, a bare KML LineString) placed in
 * the flight's own schedule: it starts at the departure and ends at the
 * arrival. The geometry is the passenger's; only the window is borrowed.
 * Null when there is no schedule to borrow — the file cannot be placed, and
 * the caller says so instead of inventing a date.
 */
export function placeUntimedTrack(
  track: ParsedTrack,
  scheduled: { departure: Date | null; arrival: Date | null }
): PlacedTrack | null {
  if (track.startedAt !== null && track.endedAt !== null) {
    return { ...track, startedAt: track.startedAt, endedAt: track.endedAt };
  }
  const startedAt = scheduled.departure ?? scheduled.arrival;
  const endedAt = scheduled.arrival ?? scheduled.departure;
  if (!startedAt || !endedAt) return null;
  return { ...track, startedAt, endedAt };
}

/** Whether every altitude is absent — then none is stored rather than a profile of gaps. */
export function withoutEmptyElevations(track: ParsedTrack): ParsedTrack {
  if (!track.elevations || track.elevations.some((e) => e !== null)) return track;
  return { ...track, elevations: undefined };
}
