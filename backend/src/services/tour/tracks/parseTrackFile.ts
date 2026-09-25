import FitParser from "fit-file-parser";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import { parseGpx, type ParsedTrack } from "./parseGpx";

/**
 * One entry point for every recording file a tour accepts: GPX, TCX and FIT.
 * Each reader produces the same `ParsedTrack`, so everything after it —
 * simplification, raw distance, climb, moving time — is one pipeline.
 *
 * The format is decided by the BYTES, never by the file name alone: a phone
 * share sheet hands over `export.xml`, and a FIT file renamed `.gpx` is still
 * binary. The name only breaks a tie that the bytes cannot.
 */

export type TrackFileFormat = "gpx" | "tcx" | "fit";

/** A FIT file carries ".FIT" at byte offset 8 of its header. */
function looksLikeFit(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.toString("ascii", 8, 12) === ".FIT";
}

export function detectTrackFormat(buffer: Buffer, fileName?: string): TrackFileFormat | null {
  if (looksLikeFit(buffer)) return "fit";
  const head = buffer.toString("utf-8", 0, Math.min(buffer.length, 4096));
  if (/<TrainingCenterDatabase[\s>]/.test(head)) return "tcx";
  if (/<gpx[\s>]/.test(head)) return "gpx";
  const ext = fileName?.toLowerCase().split(".").pop();
  return ext === "gpx" || ext === "tcx" || ext === "fit" ? ext : null;
}

function finite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function epochMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Point {
  lon: number;
  lat: number;
  ele: number | null;
  time: number | null;
}

/** Assembles a `ParsedTrack` from per-segment point lists; null if under two points. */
function assemble(segments: Point[][], name: string | null): ParsedTrack | null {
  const points: Array<[number, number]> = [];
  const elevations: Array<number | null> = [];
  const times: Array<number | null> = [];
  const segmentStarts: number[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    segmentStarts.push(points.length);
    for (const p of segment) {
      points.push([p.lon, p.lat]);
      elevations.push(p.ele);
      times.push(p.time);
    }
  }
  if (points.length < 2) return null;

  let min: number | null = null;
  let max: number | null = null;
  for (const t of times) {
    if (t === null) continue;
    if (min === null || t < min) min = t;
    if (max === null || t > max) max = t;
  }

  return {
    points,
    segmentStarts: segmentStarts.length > 0 ? segmentStarts : [0],
    startedAt: min === null ? null : new Date(min),
    endedAt: max === null ? null : new Date(max),
    name,
    elevations,
    times,
  };
}

function validPoint(lat: number | null, lon: number | null): lat is number {
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

const tcxParser = new XMLParser({ ignoreAttributes: true, trimValues: true });

/**
 * TCX (Garmin Training Center): Activities › Activity › Lap › Track ›
 * Trackpoint. Each `<Track>` is a stretch of continuous recording — the same
 * boundary GPX draws with `<trkseg>` — so each becomes its own segment.
 */
export function parseTcx(xml: string): ParsedTrack | null {
  try {
    if (XMLValidator.validate(xml) !== true) return null;
    const root: unknown = tcxParser.parse(xml);
    if (!isRecord(root) || !isRecord(root["TrainingCenterDatabase"])) return null;
    const activities = root["TrainingCenterDatabase"]["Activities"];
    if (!isRecord(activities)) return null;

    const segments: Point[][] = [];
    for (const activity of asArray(activities["Activity"]).filter(isRecord)) {
      for (const lap of asArray(activity["Lap"]).filter(isRecord)) {
        for (const track of asArray(lap["Track"]).filter(isRecord)) {
          const segment: Point[] = [];
          for (const tp of asArray(track["Trackpoint"]).filter(isRecord)) {
            const pos = tp["Position"];
            if (!isRecord(pos)) continue;
            const lat = finite(pos["LatitudeDegrees"]);
            const lon = finite(pos["LongitudeDegrees"]);
            if (!validPoint(lat, lon)) continue;
            segment.push({
              lat,
              lon: lon as number,
              ele: finite(tp["AltitudeMeters"]),
              time: epochMs(tp["Time"]),
            });
          }
          segments.push(segment);
        }
      }
    }
    // No name: a TCX Activity `Id` is the start timestamp, not a title a
    // person gave the tour, and showing it as one reads like a bug.
    return assemble(segments, null);
  } catch {
    return null;
  }
}

/**
 * FIT, the binary format of Garmin, Wahoo, Coros, Suunto and most bike
 * computers. `fit-file-parser` converts semicircles to degrees and scales the
 * altitude; `enhanced_altitude` wins where both exist, since plain
 * `altitude` overflows above ~12 km of offset-scaled range on some devices.
 *
 * A pause the device recorded as a timer stop is NOT turned into a segment
 * break here: FIT marks it with `event` messages, which are not read. The
 * moving-time measure already refuses long intervals, so a paused stretch
 * never counts as walking; distance across it is a straight line, the same as
 * an auto-paused GPX.
 */
export async function parseFit(buffer: Buffer): Promise<ParsedTrack | null> {
  try {
    const parser = new FitParser({ force: true, lengthUnit: "m", mode: "list" });
    const parsed = await parser.parseAsync(buffer as unknown as Buffer<ArrayBuffer>);
    const segment: Point[] = [];
    for (const record of parsed.records ?? []) {
      const r = record as unknown as Record<string, unknown>;
      const lat = finite(r["position_lat"]);
      const lon = finite(r["position_long"]);
      if (!validPoint(lat, lon)) continue;
      segment.push({
        lat,
        lon: lon as number,
        ele: finite(r["enhanced_altitude"]) ?? finite(r["altitude"]),
        time: epochMs(r["timestamp"]),
      });
    }
    return assemble([segment], null);
  } catch {
    return null;
  }
}

export interface ParsedTrackFile {
  format: TrackFileFormat;
  track: ParsedTrack;
}

/** Reads any supported recording file; `null` when it is none of them or unreadable. */
export async function parseTrackFile(
  buffer: Buffer,
  fileName?: string
): Promise<ParsedTrackFile | null> {
  const format = detectTrackFormat(buffer, fileName);
  if (format === null) return null;
  const track =
    format === "fit"
      ? await parseFit(buffer)
      : format === "tcx"
        ? parseTcx(buffer.toString("utf-8"))
        : parseGpx(buffer.toString("utf-8"));
  return track ? { format, track } : null;
}
