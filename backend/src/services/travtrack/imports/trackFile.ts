import { AppError } from "../../../middleware/errorHandler";
import { runInChild, unreadable } from "./trackFileChild";
import { timelineSource } from "./timelineChildSource";
import { xmlTrackSource } from "./xmlTrackChildSource";
import type { GpxWorkerOptions } from "./gpxWorker";
import { GPX_IMPORT_MAX_BYTES, mapGpx, readGpxFile } from "./mapGpx";

/**
 * Any track file TravTrack takes (TravTrack plan E8, forgejo#394): GPX, the
 * Google Timeline exports (old `Records.json`, Semantic Location History, the
 * on-device Timeline), GeoJSON, KML and TCX. The format is read from the
 * file's content, never its name. Everything is read in a child process
 * (`gpxWorker.ts`, `trackFileChild.ts`); the points come back as typed arrays
 * and become ingest points a batch at a time, so a file of a million fixes
 * never exists as a million objects.
 *
 * FIT is recognised and refused with its own code: it is a binary format and
 * no dependency-free reader is part of this change.
 */

/** XML formats: the GPX cap, since their tree is built in memory. */
export const XML_IMPORT_MAX_BYTES = GPX_IMPORT_MAX_BYTES;
/** JSON formats are scanned, not parsed whole: a Takeout `Records.json` runs to hundreds of MB. */
export const JSON_IMPORT_MAX_BYTES = 200 * 1024 * 1024;
/** What the upload may carry at all; `assertImportSize` narrows it by format. */
export const TRACK_IMPORT_MAX_BYTES = JSON_IMPORT_MAX_BYTES;
/** The most fixes a JSON file may hold. */
export const TIMELINE_IMPORT_MAX_POINTS = 2_000_000;
const TIMELINE_HEAP_MB = 512;
const XML_HEAP_MB = 384;
const TIMELINE_TIMEOUT_MS = 10 * 60_000;
const XML_TIMEOUT_MS = 60_000;

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

/** The points of a file, handed out a batch at a time. */
export type MappedTrack = {
  /** Fixes with a time: what will be stored. */
  count: number;
  batch: (at: number, size: number) => Record<string, unknown>[];
  /** Fixes the file held, readable or not. */
  read: number;
  invalid: number;
  /** Of those read, without a time: not stored. */
  withoutTime: number;
  fromMs: number | null;
  untilMs: number | null;
  /** What was read, e.g. `gpx`, `google-records`. */
  formats: string[];
};

type Fixes = {
  lat: Float64Array;
  lon: Float64Array;
  time: Float64Array;
  acc: Float64Array;
  alt: Float64Array;
  speed: Float64Array;
  course: Float64Array;
  motion: Int8Array;
  invalid: number;
  formats: string[];
};

const MOTIONS = ["stationary", "walking", "running", "cycling", "automotive"] as const;
const orNull = (v: number, min: number, max: number): number | null =>
  Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Fixes as ingest points: a value the file does not carry stays null, never 0. */
export function mapFixes(fixes: Fixes): MappedTrack {
  const withTime: number[] = [];
  let fromMs: number | null = null;
  let untilMs: number | null = null;
  for (let i = 0; i < fixes.time.length; i++) {
    const t = fixes.time[i];
    if (!Number.isFinite(t)) continue;
    withTime.push(i);
    if (fromMs === null || t < fromMs) fromMs = t;
    if (untilMs === null || t > untilMs) untilMs = t;
  }
  return {
    count: withTime.length,
    batch: (at, size) =>
      withTime.slice(at, at + size).map((i, k) => ({
        id: `${at + k}`,
        t: new Date(fixes.time[i]).toISOString(),
        lat: fixes.lat[i],
        lon: fixes.lon[i],
        accuracy: orNull(fixes.acc[i], 0, 100_000),
        altitude: orNull(fixes.alt[i], -1_000, 30_000),
        speed: orNull(fixes.speed[i], 0, 1_000),
        course: orNull(fixes.course[i], 0, 360),
        motion: fixes.motion[i] >= 0 ? MOTIONS[fixes.motion[i]] : null,
        purpose: "everyday",
      })),
    read: fixes.lat.length + fixes.invalid,
    invalid: fixes.invalid,
    withoutTime: fixes.lat.length - withTime.length,
    fromMs,
    untilMs,
    formats: fixes.formats,
  };
}

export type ReadOptions = GpxWorkerOptions & {
  /** Bytes read so far, of the total. */
  onProgress?: (done: number, total: number) => void;
};

const fixesOf = (
  source: string,
  buffer: Buffer,
  format: string,
  limits: { heapMb: number; timeoutMs: number },
  maxPoints: number,
  opts: ReadOptions
): Promise<Fixes> =>
  runInChild<Fixes>({
    source,
    buffer,
    job: {},
    limits,
    maxPoints,
    format,
    onProgress: opts.onProgress,
  });

/** The file as mappable points, or a stable refusal. */
export async function readTrackFile(
  buffer: Buffer,
  opts: ReadOptions = {}
): Promise<{ format: TrackFormat; track: MappedTrack }> {
  const format = sniffFormat(buffer);
  // Not a format we know is "unreadable", as GPX said before there were others; FIT is
  // known and named, so the person is told why and not that the file is broken.
  if (format === null) throw unreadable("a track file");
  if (format === "fit") {
    throw new AppError(
      "FIT files are not supported yet",
      422,
      "TRAVTRACK_IMPORT_UNSUPPORTED_FORMAT"
    );
  }
  if (format === "gpx") {
    const m = mapGpx(await readGpxFile(buffer, opts));
    const track: MappedTrack = {
      count: m.points.length,
      batch: (at, size) => m.points.slice(at, at + size),
      read: m.read,
      invalid: m.invalid,
      withoutTime: m.withoutTime,
      fromMs: m.fromMs,
      untilMs: m.untilMs,
      formats: ["gpx"],
    };
    return { format, track };
  }
  if (format === "json") {
    const max = opts.maxPoints ?? TIMELINE_IMPORT_MAX_POINTS;
    const fixes = await fixesOf(
      timelineSource(),
      buffer,
      "Google Timeline or GeoJSON",
      { heapMb: opts.heapMb ?? TIMELINE_HEAP_MB, timeoutMs: opts.timeoutMs ?? TIMELINE_TIMEOUT_MS },
      max,
      opts
    );
    return { format, track: mapFixes(fixes) };
  }
  const max = opts.maxPoints ?? TIMELINE_IMPORT_MAX_POINTS;
  const fixes = await fixesOf(
    xmlTrackSource(require.resolve("fast-xml-parser")),
    buffer,
    format.toUpperCase(),
    { heapMb: opts.heapMb ?? XML_HEAP_MB, timeoutMs: opts.timeoutMs ?? XML_TIMEOUT_MS },
    max,
    opts
  );
  return { format, track: mapFixes(fixes) };
}
