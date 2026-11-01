import fs from "node:fs";

import { AppError } from "../../../middleware/errorHandler";
import { runInChild, unreadable } from "./trackFileChild";
import { timelineSource } from "./timelineChildSource";
import { xmlTrackSource } from "./xmlTrackChildSource";
import type { GpxWorkerOptions } from "./gpxWorker";
import { mapGpx, readGpxFile } from "./mapGpx";
import { discardSpool, readHead, spoolBuffer } from "./spool";
import { sniffFormat, type TrackFormat } from "./trackFormat";

export {
  assertImportSize,
  JSON_IMPORT_MAX_BYTES,
  sniffFormat,
  TRACK_IMPORT_MAX_BYTES,
  XML_IMPORT_MAX_BYTES,
  type TrackFormat,
} from "./trackFormat";

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

/** The most fixes a JSON file may hold. */
export const TIMELINE_IMPORT_MAX_POINTS = 2_000_000;
const TIMELINE_HEAP_MB = 512;
const XML_HEAP_MB = 384;
const TIMELINE_TIMEOUT_MS = 10 * 60_000;
const XML_TIMEOUT_MS = 60_000;

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
  file: string,
  format: string,
  limits: { heapMb: number; timeoutMs: number },
  maxPoints: number,
  opts: ReadOptions
): Promise<Fixes> =>
  runInChild<Fixes>({
    source,
    job: { path: file },
    limits,
    maxPoints,
    format,
    onProgress: opts.onProgress,
  });

/** A file on disk, or bytes the caller already holds (they are spooled and removed again). */
export type TrackInput = Buffer | { path: string };

/** The file as mappable points, or a stable refusal. */
export async function readTrackFile(
  input: TrackInput,
  opts: ReadOptions = {}
): Promise<{ format: TrackFormat; track: MappedTrack }> {
  if (Buffer.isBuffer(input)) {
    const file = await spoolBuffer(input);
    try {
      return await readTrackFile({ path: file }, opts);
    } finally {
      discardSpool(file);
    }
  }
  const file = input.path;
  const format = sniffFormat(await readHead(file));
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
    // At most the XML cap (checked as the upload streamed in), so a buffer is fine here.
    const m = mapGpx(await readGpxFile(await fs.promises.readFile(file), opts));
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
  const max = opts.maxPoints ?? TIMELINE_IMPORT_MAX_POINTS;
  if (format === "json") {
    const fixes = await fixesOf(
      timelineSource(),
      file,
      "Google Timeline or GeoJSON",
      { heapMb: opts.heapMb ?? TIMELINE_HEAP_MB, timeoutMs: opts.timeoutMs ?? TIMELINE_TIMEOUT_MS },
      max,
      opts
    );
    return { format, track: mapFixes(fixes) };
  }
  const fixes = await fixesOf(
    xmlTrackSource(require.resolve("fast-xml-parser")),
    file,
    format.toUpperCase(),
    { heapMb: opts.heapMb ?? XML_HEAP_MB, timeoutMs: opts.timeoutMs ?? XML_TIMEOUT_MS },
    max,
    opts
  );
  return { format, track: mapFixes(fixes) };
}
