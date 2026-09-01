import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Pure GPX -> ParsedTrack parsing. No file system, no database, no network:
 * an XML string in, a structure out (or `null` if the file cannot be read
 * at all).
 *
 * `startedAt`/`endedAt` are nullable by controller ruling (2026-08-29, task 2
 * of the tour-tracks-p3b feature): the plan this task derives from declared
 * `startedAt: Date` while its own test case demanded that a GPX with no
 * `<time>` elements still parse — the two cannot both hold. The resolution:
 * parsing SUCCEEDS without timestamps and reports `null` for both fields.
 * The caller (`ingestTrack`, task 3) is what refuses to STORE a track with
 * no time window — putting that refusal here would conflate "this file is
 * unreadable" with "this file is readable but we cannot use it", and the
 * upload endpoint owes the user a different message for each.
 */

export interface ParsedTrack {
  /** `[lon, lat]` tuples, GeoJSON order, in travel order. */
  points: Array<[number, number]>;
  startedAt: Date | null;
  endedAt: Date | null;
  name: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  trimValues: true,
});

/** A parsed XML element, before we have checked what is actually inside it. */
type XmlNode = Record<string, unknown>;

function isXmlNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * fast-xml-parser returns a bare object for exactly one sibling tag and an
 * array once there are two or more of the same tag. A parser that only reads
 * the bare-object shape truncates every file with two-or-more `<trkseg>` or
 * `<trkpt>` elements — which is most real recordings. Normalising through
 * this everywhere is what makes that shape difference invisible to the rest
 * of the module.
 */
function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toValidDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

interface RawPoint {
  lon: number;
  lat: number;
  time: Date | null;
}

/**
 * Reads one `<trkpt>` or `<rtept>` element. Returns `null` when `lat`/`lon`
 * is missing, non-numeric, or out of range (`|lat| > 90`, `|lon| > 180`) —
 * the caller drops that single point rather than rejecting the whole file.
 */
function parsePoint(node: unknown): RawPoint | null {
  if (!isXmlNode(node)) return null;
  const lat = toFiniteNumber(node["@_lat"]);
  const lon = toFiniteNumber(node["@_lon"]);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon, lat, time: toValidDate(node["time"]) };
}

interface Collected {
  points: RawPoint[];
  name: string | null;
}

/** Every `<trkpt>` from every `<trkseg>` of every `<trk>`, in file order. */
function collectFromTracks(gpx: XmlNode): Collected | null {
  const tracks = toArray(gpx["trk"]).filter(isXmlNode);
  if (tracks.length === 0) return null;

  const points: RawPoint[] = [];
  let name: string | null = null;
  for (const track of tracks) {
    name ??= toNonEmptyString(track["name"]);
    const segments = toArray(track["trkseg"]).filter(isXmlNode);
    for (const segment of segments) {
      for (const rawPoint of toArray(segment["trkpt"])) {
        const point = parsePoint(rawPoint);
        if (point) points.push(point);
      }
    }
  }
  return { points, name };
}

/** Every `<rtept>` from every `<rte>`, for exporters that emit routes instead of tracks. */
function collectFromRoutes(gpx: XmlNode): Collected | null {
  const routes = toArray(gpx["rte"]).filter(isXmlNode);
  if (routes.length === 0) return null;

  const points: RawPoint[] = [];
  let name: string | null = null;
  for (const route of routes) {
    name ??= toNonEmptyString(route["name"]);
    for (const rawPoint of toArray(route["rtept"])) {
      const point = parsePoint(rawPoint);
      if (point) points.push(point);
    }
  }
  return { points, name };
}

function findGpxRoot(parsed: unknown): XmlNode | null {
  if (!isXmlNode(parsed)) return null;
  const gpx = parsed["gpx"];
  return isXmlNode(gpx) ? gpx : null;
}

/**
 * The earliest and latest of a list of epoch-millisecond timestamps.
 *
 * Deliberately NOT `Math.min(...values)` / `Math.max(...values)`: spreading
 * an array into a call's arguments has an engine call-argument ceiling
 * (tens of thousands, well below a multi-day 1 Hz recording's point count).
 * Past that ceiling the spread throws, the outer try/catch in `parseGpx`
 * swallows it, and a perfectly valid file comes back `null` — indistinguishable
 * from malformed XML to the caller. A single pass has no such ceiling.
 */
function timeWindow(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

export function parseGpx(xml: string): ParsedTrack | null {
  if (typeof xml !== "string" || xml.trim() === "") return null;

  try {
    // fast-xml-parser's own parse() is a best-effort reader and does not
    // reliably reject malformed markup (unclosed tags, mismatched nesting)
    // on its own — validate first so "unreadable" reliably means `null`.
    if (XMLValidator.validate(xml) !== true) return null;

    const parsed: unknown = parser.parse(xml);
    const gpx = findGpxRoot(parsed);
    if (!gpx) return null;

    const collected = collectFromTracks(gpx) ?? collectFromRoutes(gpx);
    if (!collected || collected.points.length < 2) return null;

    const points: Array<[number, number]> = collected.points.map((p) => [p.lon, p.lat]);
    const timestamps = collected.points
      .map((p) => p.time)
      .filter((t): t is Date => t !== null)
      .map((t) => t.getTime());

    const window = timeWindow(timestamps);
    const startedAt = window ? new Date(window.min) : null;
    const endedAt = window ? new Date(window.max) : null;

    return { points, startedAt, endedAt, name: collected.name };
  } catch {
    return null;
  }
}
