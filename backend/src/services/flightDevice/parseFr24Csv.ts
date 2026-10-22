import type { ParsedTrack } from "../tour/tracks/parseGpx";

/**
 * Flightradar24's per-flight CSV download -> `ParsedTrack` (forgejo#312).
 *
 *   Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction
 *   1507989561,2017-10-14T13:59:21Z,QXE2334,"47.424725,-122.306244",1410,140,174
 *
 * `Timestamp` is Unix seconds and `UTC` the same instant as ISO text; either
 * is enough. `Position` is "lat,lon" — latitude FIRST, the opposite of KML —
 * quoted because it holds the delimiter. `Altitude` is feet (barometric, as
 * the transponder reports it) and is stored as metres like every other
 * altitude. `Speed` (knots) and `Direction` are not kept.
 *
 * Columns are found by name, not position, so a reordered or extended export
 * still reads. A row without a time or a position is dropped on its own; the
 * rest are sorted by time.
 */

export type Fr24CsvRefusal = "csvColumns" | "csvNoPositions";
export type Fr24CsvResult =
  { ok: true; track: ParsedTrack } | { ok: false; reason: Fr24CsvRefusal };

const FEET_TO_M = 0.3048;

/** One CSV line into fields; `"…"` may hold commas and `""` is a quote. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function lines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
}

interface Columns {
  timestamp: number;
  utc: number;
  callsign: number;
  position: number;
  altitude: number;
}

function columnsOf(header: string): Columns | null {
  const names = splitCsvLine(header).map((n) => n.toLowerCase());
  const at = (name: string) => names.indexOf(name);
  const columns = {
    timestamp: at("timestamp"),
    utc: at("utc"),
    callsign: at("callsign"),
    position: at("position"),
    altitude: at("altitude"),
  };
  if (columns.position < 0 || (columns.timestamp < 0 && columns.utc < 0)) return null;
  return columns;
}

/** Whether the first line is Flightradar24's track header. */
export function looksLikeFr24Csv(head: string): boolean {
  const first = lines(head)[0];
  return first !== undefined && columnsOf(first) !== null;
}

function rowTime(fields: string[], c: Columns): number | null {
  const rawSeconds = c.timestamp >= 0 ? fields[c.timestamp]?.trim() : "";
  const seconds = rawSeconds ? Number(rawSeconds) : NaN;
  if (Number.isFinite(seconds)) return seconds * 1000;
  const iso = c.utc >= 0 ? Date.parse(fields[c.utc] ?? "") : NaN;
  return Number.isFinite(iso) ? iso : null;
}

interface Row {
  lon: number;
  lat: number;
  ele: number | null;
  time: number;
}

function rowOf(fields: string[], c: Columns): Row | null {
  const time = rowTime(fields, c);
  const [lat, lon] = (fields[c.position] ?? "").split(",").map((p) => Number(p.trim()));
  if (time === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const rawAlt = c.altitude >= 0 ? fields[c.altitude]?.trim() : "";
  const feet = rawAlt ? Number(rawAlt) : NaN;
  return { lon, lat, ele: Number.isFinite(feet) ? feet * FEET_TO_M : null, time };
}

export function parseFr24Csv(text: string): Fr24CsvResult {
  const [header, ...body] = lines(text);
  const columns = header === undefined ? null : columnsOf(header);
  if (!columns) return { ok: false, reason: "csvColumns" };

  let name: string | null = null;
  const rows: Row[] = [];
  for (const line of body) {
    const fields = splitCsvLine(line);
    const row = rowOf(fields, columns);
    if (!row) continue;
    rows.push(row);
    if (columns.callsign >= 0) name ??= fields[columns.callsign] || null;
  }
  if (rows.length < 2) return { ok: false, reason: "csvNoPositions" };

  const ordered = [...rows].sort((a, b) => a.time - b.time);
  return {
    ok: true,
    track: {
      points: ordered.map((r): [number, number] => [r.lon, r.lat]),
      segmentStarts: [0],
      startedAt: new Date(ordered[0].time),
      endedAt: new Date(ordered[ordered.length - 1].time),
      name,
      elevations: ordered.map((r) => r.ele),
      times: ordered.map((r) => r.time),
    },
  };
}
