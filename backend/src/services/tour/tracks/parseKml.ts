import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { ParsedTrack } from "./parseGpx";

/**
 * KML -> `ParsedTrack` (forgejo#312), the format flight trackers export.
 * Pure: a string in, a track or the reason there is none out.
 *
 * Three shapes are read, in order of preference, and the first that yields a
 * line wins — they are alternatives, never merged:
 *
 *   1. `gx:Track` — FlightAware's "Google Earth KML": one placemark holding
 *      parallel `<when>` and `<gx:coord>` lists ("lon lat alt", space
 *      separated, altitude mode absolute), beside two `<Point>` placemarks for
 *      the origin and destination airports. The airports carry no time and are
 *      never read as positions. The lists may come as two blocks or
 *      interleaved (`when, coord, when, coord`); KML allows both and both are
 *      read. A `gx:MultiTrack` is its tracks, each one recorded stretch. A
 *      track whose two lists differ in length cannot be paired, so the file is
 *      refused rather than guessed at.
 *   2. Timestamped `<Point>` placemarks — Flightradar24's export: a folder of
 *      one placemark per position, each with a `<TimeStamp><when>` (a
 *      `<TimeSpan><begin>` is read the same way), beside a "Trail" drawn as
 *      untimed `<LineString>`s. The timed points are the recording, sorted by
 *      time because the folder's order is not a promise; the trail is a
 *      drawing of it, and reading both would draw the flight twice — or pair
 *      the trail's vertices with times nobody recorded.
 *   3. `<LineString>` — a bare line ("lon,lat[,alt]" tuples). It has no times;
 *      the caller decides whether it can place it (a flight can, from its
 *      schedule). A trail cut into many short lines that meet end to end (one
 *      per colour band) is one stretch, not a gap at every joint.
 *
 * Altitude is metres, KML's unit. Two exceptions, because exporters do not all
 * honour that: an altitude a placemark's description states with its unit
 * ("Altitude: 35,000 ft") wins over the coordinate, and coordinate altitudes
 * above `MAX_ALTITUDE_M` — higher than anything this app records flies — can
 * only be feet and are converted. A position outside the globe is dropped on
 * its own, as `parseGpx` does, rather than refusing the file.
 */

export type KmlRefusal = "kmlInvalid" | "kmlUnpaired" | "kmlNoTrack";
export type KmlResult = { ok: true; track: ParsedTrack } | { ok: false; reason: KmlRefusal };

const FEET_TO_M = 0.3048;

/**
 * 20 km. Concorde cruised at 18 km and business jets top out near 15.5 km,
 * while a cruise level of FL350 read as metres is 35 km — so a value above
 * this cannot be metres, and a file that has one wrote feet.
 */
const MAX_ALTITUDE_M = 20_000;

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
  /** The altitude came with a stated unit and is already metres. */
  eleStated?: boolean;
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

/** Every text below a node, joined — a description may be HTML parsed into elements. */
function flatText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flatText).join(" ");
  if (isXmlNode(value)) return Object.values(value).map(flatText).join(" ");
  return "";
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
  const [lon, lat, alt] = parts.map((p) => (p.trim() === "" ? NaN : Number(p)));
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
    // Pushed one by one: spreading a 300,000-placemark folder into `push`
    // passes that many arguments and overflows the stack.
    if (k === key) for (const item of asArray(v)) out.push(item);
    else collect(v, key, out);
  }
  return out;
}

/** Every placemark in the document, folders included. */
function placemarks(root: XmlNode): XmlNode[] {
  return collect(root, "Placemark").filter(isXmlNode);
}

interface Reading {
  segments: Point[][];
  name: string | null;
}

/** `gx:Track`s as segments; `null` when a track's times and positions do not pair up. */
function fromTracks(root: XmlNode): Reading | null {
  const segments: Point[][] = [];
  let name: string | null = null;
  for (const placemark of placemarks(root)) {
    for (const track of collect(placemark, "Track").filter(isXmlNode)) {
      const whens = asArray(track["when"]);
      const coords = asArray(track["coord"]);
      if (whens.length !== coords.length) return null;
      const segment: Point[] = [];
      coords.forEach((coord, i) => {
        const point = toPoint((text(coord) ?? "").split(/\s+/), epochMs(whens[i]));
        if (point) segment.push(point);
      });
      if (segment.length > 0) name ??= text(placemark["name"]);
      segments.push(segment);
    }
  }
  return { segments, name };
}

/** "Altitude: 35,000 ft" (or "… m") from a placemark's description, as metres. */
function statedAltitude(placemark: XmlNode): number | null {
  const description = flatText(placemark["description"]);
  const match = /altitude\D{0,40}?(-?[\d,.]+)\s*(ft|feet|m)\b/i.exec(description);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return match[2].toLowerCase() === "m" ? value : value * FEET_TO_M;
}

function placemarkTime(placemark: XmlNode): number | null {
  const stamp = placemark["TimeStamp"];
  if (isXmlNode(stamp)) return epochMs(stamp["when"]);
  const span = placemark["TimeSpan"];
  if (isXmlNode(span)) return epochMs(span["begin"]);
  return null;
}

/** Placemarks with a `<Point>` AND a time, as one stretch in time order. */
function fromTimedPoints(root: XmlNode): Reading {
  const points: Point[] = [];
  for (const placemark of placemarks(root)) {
    const point = placemark["Point"];
    if (!isXmlNode(point)) continue;
    const time = placemarkTime(placemark);
    if (time === null) continue;
    const parsed = toPoint((text(point["coordinates"]) ?? "").split(","), time);
    if (!parsed) continue;
    const stated = statedAltitude(placemark);
    points.push(stated === null ? parsed : { ...parsed, ele: stated, eleStated: true });
  }
  // A stable sort: two positions in the same second keep the file's order.
  const ordered = [...points].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  return { segments: [ordered], name: null };
}

function sameSpot(a: Point, b: Point): boolean {
  return Math.abs(a.lon - b.lon) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9;
}

/** Every `<LineString>` as an untimed stretch; lines that meet end to end are one. */
function fromLineStrings(root: XmlNode): Reading {
  const segments: Point[][] = [];
  let name: string | null = null;
  for (const placemark of placemarks(root)) {
    for (const line of collect(placemark, "LineString").filter(isXmlNode)) {
      const points = (text(line["coordinates"]) ?? "")
        .split(/\s+/)
        .map((tuple) => toPoint(tuple.split(","), null))
        .filter((p): p is Point => p !== null);
      if (points.length === 0) continue;
      name ??= text(placemark["name"]);
      const previous = segments[segments.length - 1];
      if (previous && sameSpot(previous[previous.length - 1], points[0])) {
        // Appended in place, never copied: a trail cut into tens of thousands
        // of short lines made a copy per joint quadratic — 6.5 s of blocked
        // event loop for a 3.7 MB file. The segment is this function's own.
        for (let i = 1; i < points.length; i += 1) previous.push(points[i]);
      } else {
        segments.push(points);
      }
    }
  }
  return { segments, name };
}

/** Coordinate altitudes that cannot be metres were written in feet. */
function inMetres(segments: Point[][]): Point[][] {
  const feet = segments.some((s) =>
    s.some((p) => !p.eleStated && p.ele !== null && p.ele > MAX_ALTITUDE_M)
  );
  if (!feet) return segments;
  return segments.map((s) =>
    s.map((p) => (p.eleStated || p.ele === null ? p : { ...p, ele: p.ele * FEET_TO_M }))
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

/** The document's own `<name>` — Flightradar24 puts the flight there. */
function documentName(root: XmlNode): string | null {
  const doc = root["Document"];
  return text(isXmlNode(doc) ? doc["name"] : root["name"]);
}

export function readKml(xml: string): KmlResult {
  const source = xml.replace(/^\uFEFF/, "");
  let root: XmlNode;
  try {
    if (XMLValidator.validate(source) !== true) return { ok: false, reason: "kmlInvalid" };
    const parsed: unknown = parser.parse(source);
    if (!isXmlNode(parsed) || !isXmlNode(parsed["kml"])) return { ok: false, reason: "kmlInvalid" };
    root = parsed["kml"];
  } catch {
    return { ok: false, reason: "kmlInvalid" };
  }

  const tracks = fromTracks(root);
  if (tracks === null) return { ok: false, reason: "kmlUnpaired" };
  const chosen = [tracks, fromTimedPoints(root), fromLineStrings(root)].find(
    (reading) => countPoints(reading.segments) >= 2
  );
  if (!chosen) return { ok: false, reason: "kmlNoTrack" };
  return {
    ok: true,
    track: assemble(inMetres(chosen.segments), chosen.name ?? documentName(root)),
  };
}

/** Whether the bytes are a KML document (decided by the root element, not the name). */
export function looksLikeKml(head: string): boolean {
  return /<(?:\w+:)?kml[\s>]/.test(head);
}
