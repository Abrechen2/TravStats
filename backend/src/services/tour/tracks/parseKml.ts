import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { ParsedTrack } from "./parseGpx";

/**
 * KML -> `ParsedTrack` (forgejo#312), the format flight trackers export.
 * Pure: a string in, a structure out, or `null` when the file is not KML or
 * holds fewer than two usable positions.
 *
 * Three shapes are read, in order of preference, and the first that yields a
 * line wins — they are alternatives, never merged:
 *
 *   1. `gx:Track` — FlightAware's export: parallel `<when>` and `<gx:coord>`
 *      lists ("lon lat alt", space-separated). Each track is one recorded
 *      stretch. A track whose two lists differ in length cannot be paired, so
 *      the file is refused rather than guessed at.
 *   2. Timestamped `<Point>` placemarks — Flightradar24's export carries one
 *      per position, beside an UNTIMED `<LineString>` trail of the same
 *      flight. The timed points are the recording; the trail is a drawing of
 *      it, and reading both would draw the flight twice.
 *   3. `<LineString>` — a bare line ("lon,lat[,alt]" tuples). It has no times;
 *      the caller decides whether it can place it (a flight can, from its
 *      schedule).
 *
 * Altitude is optional everywhere and kept as metres where present (KML's
 * unit). A position outside the globe is dropped on its own, as `parseGpx`
 * does, rather than refusing the file.
 */

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

interface Point {
  lon: number;
  lat: number;
  ele: number | null;
  time: number | null;
}

function isXmlNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (isXmlNode(value) && typeof value["#text"] === "string") return text(value["#text"]);
  return null;
}

function epochMs(value: unknown): number | null {
  const s = text(value);
  if (s === null) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** One position from its numeric parts; null when off the globe or not numbers. */
function toPoint(parts: string[], time: number | null): Point | null {
  if (parts.length < 2) return null;
  const [lon, lat, alt] = parts.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon, lat, ele: Number.isFinite(alt) ? alt : null, time };
}

/** Every value stored under `key` anywhere below `node`, in document order per parent. */
function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
    return out;
  }
  if (!isXmlNode(node)) return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(...asArray(v));
    else collect(v, key, out);
  }
  return out;
}

/** `gx:Track`s as segments; `null` when a track's times and positions do not pair up. */
function fromTracks(root: XmlNode): Point[][] | null {
  const segments: Point[][] = [];
  for (const track of collect(root, "Track").filter(isXmlNode)) {
    const whens = asArray(track["when"]);
    const coords = asArray(track["coord"]);
    if (whens.length !== coords.length) return null;
    const segment: Point[] = [];
    coords.forEach((coord, i) => {
      const point = toPoint((text(coord) ?? "").split(/\s+/), epochMs(whens[i]));
      if (point) segment.push(point);
    });
    segments.push(segment);
  }
  return segments;
}

/** Placemarks with a `<Point>` AND a `<TimeStamp>`, as one stretch in time order. */
function fromTimedPoints(root: XmlNode): Point[][] {
  const points: Point[] = [];
  for (const placemark of collect(root, "Placemark").filter(isXmlNode)) {
    const stamp = placemark["TimeStamp"];
    const point = placemark["Point"];
    if (!isXmlNode(stamp) || !isXmlNode(point)) continue;
    const time = epochMs(stamp["when"]);
    if (time === null) continue;
    const parsed = toPoint((text(point["coordinates"]) ?? "").split(","), time);
    if (parsed) points.push(parsed);
  }
  // The exporters list positions newest first as often as oldest first.
  return [[...points].sort((a, b) => (a.time ?? 0) - (b.time ?? 0))];
}

/** Every `<LineString>` as its own untimed stretch. */
function fromLineStrings(root: XmlNode): Point[][] {
  return collect(root, "LineString")
    .filter(isXmlNode)
    .map((line) =>
      (text(line["coordinates"]) ?? "")
        .split(/\s+/)
        .map((tuple) => toPoint(tuple.split(","), null))
        .filter((p): p is Point => p !== null)
    );
}

function countPoints(segments: Point[][]): number {
  return segments.reduce((sum, s) => sum + s.length, 0);
}

function assemble(segments: Point[][], name: string | null): ParsedTrack {
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
  let min: number | null = null;
  let max: number | null = null;
  for (const t of times) {
    if (t === null) continue;
    if (min === null || t < min) min = t;
    if (max === null || t > max) max = t;
  }
  return {
    points,
    segmentStarts,
    startedAt: min === null ? null : new Date(min),
    endedAt: max === null ? null : new Date(max),
    name,
    elevations,
    times,
  };
}

/** The first `<name>` of a placemark that carries the line, else of the document. */
function firstName(root: XmlNode): string | null {
  for (const placemark of collect(root, "Placemark").filter(isXmlNode)) {
    const name = text(placemark["name"]);
    if (name) return name;
  }
  return null;
}

export function parseKml(xml: string): ParsedTrack | null {
  try {
    if (XMLValidator.validate(xml) !== true) return null;
    const parsed: unknown = parser.parse(xml);
    if (!isXmlNode(parsed) || !isXmlNode(parsed["kml"])) return null;
    const root = parsed["kml"];

    const tracks = fromTracks(root);
    if (tracks === null) return null;
    const candidates = [tracks, fromTimedPoints(root), fromLineStrings(root)];
    const chosen = candidates.find((segments) => countPoints(segments) >= 2);
    return chosen ? assemble(chosen, firstName(root)) : null;
  } catch {
    return null;
  }
}

/** Whether the bytes are a KML document (decided by the root element, not the name). */
export function looksLikeKml(head: string): boolean {
  return /<kml[\s>]/.test(head);
}
