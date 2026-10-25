import { AppError } from "../../../middleware/errorHandler";
import { parseGpx, type ParsedTrack } from "../../tour/tracks/parseGpx";

/**
 * A GPX file as TravTrack points (TravTrack plan E8). The file is untrusted
 * input: it is read from memory only (never a path, never the disk), it is
 * capped in size before it gets here (`GPX_IMPORT_MAX_BYTES`), and a document
 * type declaration is refused before any parser sees it — GPX has no use for
 * one, and a DTD is the door for entity expansion (billion laughs) and
 * external entities (XXE). Parsing itself is the tour-track parser, which
 * validates first, so a malformed file is unreadable rather than half read.
 */

/** The largest file the import takes. */
export const GPX_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

/** The longest file name kept, as the column allows. */
const FILE_NAME_MAX = 200;

/** `<!DOCTYPE` or `<!ENTITY`, with any whitespace and case. */
const DTD = /<!\s*(doctype|entity)/i;

const unreadable = () =>
  new AppError("The file could not be read as GPX", 422, "TRAVTRACK_IMPORT_UNREADABLE");

/** The parsed track, or `TRAVTRACK_IMPORT_UNREADABLE`. */
export function readGpxFile(buffer: Buffer): ParsedTrack {
  if (buffer.length === 0 || buffer.length > GPX_IMPORT_MAX_BYTES) throw unreadable();
  const xml = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (DTD.test(xml)) throw unreadable();
  const track = parseGpx(xml);
  if (!track) throw unreadable();
  return track;
}

/** A receiver's elevation within what the point store takes; anything else is unknown. */
const altitudeOf = (ele: number | null | undefined) =>
  ele === null || ele === undefined || ele < -1_000 || ele > 30_000 ? null : ele;

export type MappedGpx = {
  /** Points as the ingest takes them; only fixes with a time. */
  points: Record<string, unknown>[];
  /** Fixes with a position the file held. */
  read: number;
  /** Of those, without a time: not stored, a position without an instant is no history. */
  withoutTime: number;
  fromMs: number | null;
  untilMs: number | null;
};

/**
 * Every fix with a time becomes a point named `<segment>:<index>` — the
 * origin's own id, so the same file imported again under the same import is a
 * duplicate by reference, and under another import by position.
 */
export function mapGpx(track: ParsedTrack): MappedGpx {
  const times = track.times ?? [];
  const elevations = track.elevations ?? [];
  const starts = track.segmentStarts.length > 0 ? track.segmentStarts : [0];
  const points: Record<string, unknown>[] = [];
  let withoutTime = 0;
  let fromMs: number | null = null;
  let untilMs: number | null = null;
  for (let segment = 0; segment < starts.length; segment++) {
    const end = segment + 1 < starts.length ? starts[segment + 1] : track.points.length;
    for (let i = starts[segment]; i < end; i++) {
      const tMs = times[i];
      if (tMs === null || tMs === undefined) {
        withoutTime += 1;
        continue;
      }
      const [lon, lat] = track.points[i];
      points.push({
        id: `${segment}:${i - starts[segment]}`,
        t: new Date(tMs).toISOString(),
        lat,
        lon,
        altitude: altitudeOf(elevations[i]),
        purpose: "everyday",
      });
      if (fromMs === null || tMs < fromMs) fromMs = tMs;
      if (untilMs === null || tMs > untilMs) untilMs = tMs;
    }
  }
  return { points, read: track.points.length, withoutTime, fromMs, untilMs };
}

/**
 * The name a person gave the file, as a label only: the last path component
 * (a browser may send a full path), no control characters, at most 200
 * characters. It never names anything on the server.
 */
export function displayFileName(name: string | undefined): string {
  const last = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = [...last]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  // By code point, so a cut never splits a character in two.
  return clean === "" ? "import.gpx" : [...clean].slice(0, FILE_NAME_MAX).join("");
}
