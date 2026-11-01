import { AppError } from "../../../middleware/errorHandler";
import { GPX_IMPORT_MAX_BYTES } from "./mapGpx";

/**
 * What a track file is, from its first bytes, and how large each format may be
 * (forgejo#394). Kept apart from the reader so the upload's storage can sniff
 * while the file streams in without importing the reader.
 */

/** XML formats: the GPX cap, since their tree is built in memory. */
export const XML_IMPORT_MAX_BYTES = GPX_IMPORT_MAX_BYTES;
/** JSON formats are scanned, not parsed whole: a Takeout `Records.json` runs to hundreds of MB. */
export const JSON_IMPORT_MAX_BYTES = 200 * 1024 * 1024;
/** What the upload may carry at all; `assertImportSize` narrows it by format. */
export const TRACK_IMPORT_MAX_BYTES = JSON_IMPORT_MAX_BYTES;
export type TrackFormat = "gpx" | "json" | "kml" | "tcx" | "fit";

/** The format a file's first bytes announce, or null when none is recognised. */
export function sniffFormat(buffer: Buffer): TrackFormat | null {
  if (buffer.length >= 12 && buffer.toString("latin1", 8, 12) === ".FIT") return "fit";
  const head = buffer
    .toString("utf8", 0, Math.min(buffer.length, 4096))
    .replace(/^\u{FEFF}/u, "")
    .trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  const root = /<(?![?!])([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(head)?.[2];
  if (root === "gpx") return "gpx";
  if (root === "kml") return "kml";
  if (root === "TrainingCenterDatabase") return "tcx";
  return null;
}

/** Over the cap of its format: 413, before an import row exists. Unknown formats get the XML cap. */
export function assertImportSize(
  format: TrackFormat | null,
  length: number,
  caps: { json?: number; xml?: number } = {}
): void {
  const cap =
    format === "json" ? (caps.json ?? JSON_IMPORT_MAX_BYTES) : (caps.xml ?? XML_IMPORT_MAX_BYTES);
  if (length > cap) throw new AppError("The file is too large", 413, "TRACK_FILE_TOO_LARGE");
}
