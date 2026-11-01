import { z } from "zod";

/**
 * GPX 1.1 and KML 2.2 writers for the download routes of forgejo#402: a
 * recorded flight or cruise track, a ride's stored line, places as waypoints.
 *
 * Both formats are produced as small string pieces (`geoHead`, `geoWaypoint`,
 * `geoLine`, `geoFoot`) that a route writes to the response one by one, so a
 * 50,000-place export never exists as one string. The stored lines carry no
 * per-point time (they are simplified on import), so none is written: a
 * fabricated time would invent a pace the record never held.
 */

export const GEO_FORMATS = ["gpx", "kml"] as const;
export type GeoFormat = (typeof GEO_FORMATS)[number];

export const geoFormatQuerySchema = z.object({ format: z.enum(GEO_FORMATS).default("gpx") });

/** `[lon, lat]` — GeoJSON order, as every stored line is kept. */
export type LonLat = readonly [number, number];

export interface GeoWaypoint {
  name: string;
  lat: number;
  lon: number;
  desc?: string | null;
  /** A free label (a place category); GPX `<type>`, KML extended data. */
  type?: string | null;
}

export interface GeoLine {
  name: string;
  desc?: string | null;
  /** One entry per recording segment; a gap stays a gap. */
  segments: readonly (readonly LonLat[])[];
}

/** XML 1.0 forbids most control characters even as entities; drop them, escape the rest. */
export function escapeXml(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- the control characters are the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

const validLonLat = (p: unknown): p is LonLat =>
  Array.isArray(p) &&
  typeof p[0] === "number" &&
  typeof p[1] === "number" &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;

/**
 * A stored `geometry` (+ `segmentStarts`) as segments of valid points. A
 * malformed vertex is dropped rather than written as `NaN`; segments left
 * with fewer than two points are dropped — one point is not a line.
 */
export function splitSegments(geometry: unknown, segmentStarts: unknown): LonLat[][] {
  if (!Array.isArray(geometry)) return [];
  const starts = Array.isArray(segmentStarts)
    ? segmentStarts.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < geometry.length)
    : [];
  const bounds = Array.from(new Set([0, ...starts])).sort((a, b) => a - b);
  const segments: LonLat[][] = [];
  bounds.forEach((from, i) => {
    const to = bounds[i + 1] ?? geometry.length;
    const points = geometry
      .slice(from, to)
      .filter(validLonLat)
      .map((p): LonLat => [p[0], p[1]]);
    if (points.length >= 2) segments.push(points);
  });
  return segments;
}

export const hasGeometry = (segments: readonly (readonly LonLat[])[]): boolean =>
  segments.some((s) => s.length >= 2);

export function geoContentType(format: GeoFormat): string {
  return format === "gpx"
    ? "application/gpx+xml; charset=utf-8"
    : "application/vnd.google-earth.kml+xml; charset=utf-8";
}

/** `2026-11-01_name.gpx`-style file name; ASCII only, so the header needs no encoding. */
export function geoFileName(name: string, format: GeoFormat, date: Date): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${date.toISOString().slice(0, 10)}_${safe || "export"}.${format}`;
}

export function geoHead(format: GeoFormat, name: string, desc?: string | null): string {
  if (format === "gpx") {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<gpx version="1.1" creator="TravStats" xmlns="http://www.topografix.com/GPX/1/1">`,
      `  <metadata>`,
      `    <name>${escapeXml(name)}</name>`,
      ...(desc ? [`    <desc>${escapeXml(desc)}</desc>`] : []),
      `  </metadata>`,
      ``,
    ].join("\n");
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2">`,
    `  <Document>`,
    `    <name>${escapeXml(name)}</name>`,
    ...(desc ? [`    <description>${escapeXml(desc)}</description>`] : []),
    ``,
  ].join("\n");
}

export function geoFoot(format: GeoFormat): string {
  return format === "gpx" ? `</gpx>\n` : `  </Document>\n</kml>\n`;
}

/** GPX requires every `<wpt>` before the first `<trk>`: write waypoints first. */
export function geoWaypoint(format: GeoFormat, wp: GeoWaypoint): string {
  if (format === "gpx") {
    return (
      `  <wpt lat="${wp.lat}" lon="${wp.lon}">` +
      `<name>${escapeXml(wp.name)}</name>` +
      (wp.desc ? `<desc>${escapeXml(wp.desc)}</desc>` : "") +
      (wp.type ? `<type>${escapeXml(wp.type)}</type>` : "") +
      `</wpt>\n`
    );
  }
  return (
    `    <Placemark><name>${escapeXml(wp.name)}</name>` +
    (wp.desc ? `<description>${escapeXml(wp.desc)}</description>` : "") +
    `<Point><coordinates>${wp.lon},${wp.lat}</coordinates></Point></Placemark>\n`
  );
}

export function geoLine(format: GeoFormat, line: GeoLine): string {
  const segments = line.segments.filter((s) => s.length >= 2);
  if (segments.length === 0) return "";
  if (format === "gpx") {
    const parts = [
      `  <trk>`,
      `    <name>${escapeXml(line.name)}</name>`,
      ...(line.desc ? [`    <desc>${escapeXml(line.desc)}</desc>`] : []),
    ];
    for (const seg of segments) {
      parts.push(`    <trkseg>`);
      for (const [lon, lat] of seg) parts.push(`      <trkpt lat="${lat}" lon="${lon}"/>`);
      parts.push(`    </trkseg>`);
    }
    parts.push(`  </trk>`, ``);
    return parts.join("\n");
  }
  const coords = (seg: readonly LonLat[]) => seg.map(([lon, lat]) => `${lon},${lat}`).join(" ");
  const strings = segments.map(
    (seg) =>
      `<LineString><tessellate>1</tessellate><coordinates>${coords(seg)}</coordinates></LineString>`
  );
  const geometry =
    strings.length === 1 ? strings[0] : `<MultiGeometry>${strings.join("")}</MultiGeometry>`;
  return (
    `    <Placemark><name>${escapeXml(line.name)}</name>` +
    (line.desc ? `<description>${escapeXml(line.desc)}</description>` : "") +
    `${geometry}</Placemark>\n`
  );
}

/** A whole small document (one track, no waypoints) as one string. */
export function geoDocument(
  format: GeoFormat,
  name: string,
  lines: readonly GeoLine[],
  desc?: string | null
): string {
  return (
    geoHead(format, name, desc) + lines.map((l) => geoLine(format, l)).join("") + geoFoot(format)
  );
}
