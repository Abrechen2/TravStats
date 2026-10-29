import { createHash } from "crypto";

import { looksLikeKml, readKml, type KmlRefusal } from "../tour/tracks/parseKml";
import { detectTrackFormat, parseTrackFile } from "../tour/tracks/parseTrackFile";
import type { ParsedTrack } from "../tour/tracks/parseGpx";
import type { FlightTrackSource } from "../../schemas/flightDevice";
import { looksLikeFr24Csv, parseFr24Csv, type Fr24CsvRefusal } from "./parseFr24Csv";
import { looksLikeZip, readKmz, type KmzRefusal } from "./readKmz";
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";

/**
 * A recorded flight uploaded as a FILE on the flight page (forgejo#312).
 *
 * KML, KMZ and Flightradar24's CSV are read here and not in the shared
 * `parseTrackFile`: they are what flight trackers export (FlightAware,
 * Flightradar24), and offering them on the tour and cruise uploads too would
 * change their accepted formats and their error copy — a decision for those
 * features, not a side effect of this one. GPX, TCX and FIT come through the
 * shared reader unchanged. A KMZ is stored as `kml`: it is one, zipped.
 */

export type FlightTrackFileFormat = Exclude<FlightTrackSource, "companion" | "aeroapi">;

export interface FlightTrackFile {
  format: FlightTrackFileFormat;
  track: ParsedTrack;
}

/**
 * Why a file gave no track — each its own sentence in the UI, because "could
 * not be read" sends someone with a FlightAware export of only the two
 * airports hunting for a broken download.
 *
 *   unsupported   the bytes are none of the formats, and the name names none
 *   unreadable    GPX, TCX or FIT that the shared reader could not use
 */
export type FlightTrackFileRefusal =
  "unsupported" | "unreadable" | KmlRefusal | KmzRefusal | Fr24CsvRefusal;

export type FlightTrackFileResult =
  ({ ok: true } & FlightTrackFile) | { ok: false; reason: FlightTrackFileRefusal };

function fromKml(xml: string): FlightTrackFileResult {
  const kml = readKml(xml);
  return kml.ok ? { ok: true, format: "kml", track: kml.track } : kml;
}

function fromCsv(text: string): FlightTrackFileResult {
  const csv = parseFr24Csv(text);
  return csv.ok ? { ok: true, format: "csv", track: csv.track } : csv;
}

async function fromShared(buffer: Buffer, fileName?: string): Promise<FlightTrackFileResult> {
  const file = await parseTrackFile(buffer, fileName);
  return file ? { ok: true, ...file } : { ok: false, reason: "unreadable" };
}

/** The bytes decide, as in `detectTrackFormat`; the name only breaks a tie. */
export async function readFlightTrackFile(
  buffer: Buffer,
  fileName?: string
): Promise<FlightTrackFileResult> {
  const head = buffer.toString("utf-8", 0, Math.min(buffer.length, 4096));
  if (looksLikeZip(buffer)) {
    const kmz = readKmz(buffer);
    return kmz.ok ? fromKml(kmz.kml) : kmz;
  }
  if (looksLikeKml(head)) return fromKml(buffer.toString("utf-8"));
  if (detectTrackFormat(buffer) !== null) return fromShared(buffer, fileName);
  if (looksLikeFr24Csv(head)) return fromCsv(buffer.toString("utf-8"));

  switch (fileName?.toLowerCase().split(".").pop()) {
    case "kml":
      return fromKml(buffer.toString("utf-8"));
    case "kmz":
      return { ok: false, reason: "kmzDamaged" };
    case "csv":
      return fromCsv(buffer.toString("utf-8"));
    case "gpx":
    case "tcx":
    case "fit":
      return fromShared(buffer, fileName);
    default:
      return { ok: false, reason: "unsupported" };
  }
}

/** Each refusal's stable code and server-side sentence (the UI maps the code to DE/EN copy). */
const REFUSALS: Readonly<Record<FlightTrackFileRefusal, { code: ApiErrorCode; message: string }>> =
  {
    unsupported: {
      code: "TRACK_FILE_UNSUPPORTED",
      message: "The file is not GPX, KML, KMZ, TCX, FIT or a Flightradar24 CSV",
    },
    unreadable: {
      code: "TRACK_FILE_UNREADABLE",
      message: "The file could not be read as GPX, TCX or FIT with at least two positions",
    },
    kmlInvalid: { code: "TRACK_KML_INVALID", message: "The KML file is not well-formed XML" },
    kmlUnpaired: {
      code: "TRACK_KML_UNPAIRED",
      message: "The KML track has a different number of times than positions",
    },
    kmlNoTrack: {
      code: "TRACK_KML_NO_TRACK",
      message: "The KML file holds no track of at least two positions",
    },
    kmzDamaged: { code: "TRACK_KMZ_DAMAGED", message: "The KMZ archive is damaged" },
    kmzNoKml: { code: "TRACK_KMZ_NO_KML", message: "The ZIP archive holds no KML file" },
    kmzTooLarge: {
      code: "TRACK_KMZ_TOO_LARGE",
      message: "The KML inside the KMZ is larger than 15 MB unpacked",
    },
    csvColumns: {
      code: "TRACK_CSV_COLUMNS",
      message: "The CSV file does not have Flightradar24's track columns",
    },
    csvNoPositions: {
      code: "TRACK_CSV_NO_POSITIONS",
      message: "The CSV file has fewer than two rows with a time and a position",
    },
  };

export function refusalError(reason: FlightTrackFileRefusal): AppError {
  const { code, message } = REFUSALS[reason];
  return new AppError(message, 400, code);
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
 * The clock semantics that are a placeholder, not a time: noon on a known day
 * (DATE_ONLY) or the 1st of a month or year (UNKNOWN). They locate a flight
 * on the calendar, never at a minute.
 */
const PLACEHOLDER_SEMANTICS = new Set(["DATE_ONLY", "UNKNOWN"]);

/**
 * A recording without times (a drawn route, a bare KML LineString) placed in
 * the flight's own schedule: it starts at the departure and ends at the
 * arrival. The geometry is the passenger's; only the window is borrowed.
 * Null when there is no schedule to borrow — the file cannot be placed, and
 * the caller says so instead of inventing a date. A placeholder clock is no
 * schedule: borrowing it would give the track a start and end to the minute
 * that nobody ever recorded.
 */
export function placeUntimedTrack(
  track: ParsedTrack,
  scheduled: { departure: Date | null; arrival: Date | null },
  semantics: { departure?: string | null; arrival?: string | null } = {}
): PlacedTrack | null {
  if (track.startedAt !== null && track.endedAt !== null) {
    return { ...track, startedAt: track.startedAt, endedAt: track.endedAt };
  }
  const real = (at: Date | null, kind: string | null | undefined) =>
    kind && PLACEHOLDER_SEMANTICS.has(kind) ? null : at;
  const departure = real(scheduled.departure, semantics.departure);
  const arrival = real(scheduled.arrival, semantics.arrival);
  const startedAt = departure ?? arrival;
  const endedAt = arrival ?? departure;
  if (!startedAt || !endedAt) return null;
  return { ...track, startedAt, endedAt };
}

/** Whether every altitude is absent — then none is stored rather than a profile of gaps. */
export function withoutEmptyElevations(track: ParsedTrack): ParsedTrack {
  if (!track.elevations || track.elevations.some((e) => e !== null)) return track;
  return { ...track, elevations: undefined };
}
