#!/usr/bin/env node
/**
 * Builds backend/data/rail/stations.csv.gz — the rail station catalogue —
 * from Trainline's stations.csv (https://github.com/trainline-eu/stations,
 * ODbL 1.0). Spec: docs/superpowers/specs/2026-09-25-rail-domain.md.
 *
 * Usage:
 *   curl -sSLo /tmp/stations.csv \
 *     https://raw.githubusercontent.com/trainline-eu/stations/master/stations.csv
 *   node backend/scripts/build-rail-stations.mjs /tmp/stations.csv
 *
 * What stays:
 *   - every row with coordinates and `is_suggestable = t` (what Trainline's own
 *     search offers — 52 k of 72 k rows on 2026-09-25);
 *   - the parent each of them points at, when the parent has coordinates. A
 *     parent without a position is dropped and the reference to it cleared,
 *     because a catalogue row the picker can offer must be drawable.
 * Columns kept: id, name, uic, db_id, lat, lon, country, time_zone, parent.
 * `db_id` is the DB EVA number db-rest addresses stops by; it is NOT the UIC
 * code (Frankfurt (Main) Hbf: UIC 8011068, EVA 8000105).
 *
 * The output is gzipped (3.5 MB of CSV → 1.2 MB) and LF-only; `*.gz` is
 * marked binary in .gitattributes, so a Windows checkout cannot rewrite it.
 * The derivative is itself ODbL — see backend/data/rail/LICENSE.txt.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) {
  console.error("usage: node backend/scripts/build-rail-stations.mjs <path/to/stations.csv>");
  process.exit(1);
}
const target = path.resolve(here, "..", "data", "rail", "stations.csv.gz");

const rows = parse(fs.readFileSync(source, "utf-8"), {
  columns: true,
  delimiter: ";",
  skip_empty_lines: true,
});
const byId = new Map(rows.map((r) => [r.id, r]));
const hasPosition = (r) => Boolean(r.latitude && r.longitude);

const keep = new Set(
  rows.filter((r) => r.is_suggestable === "t" && hasPosition(r)).map((r) => r.id)
);
for (const id of [...keep]) {
  const parent = byId.get(byId.get(id).parent_station_id);
  if (parent && hasPosition(parent)) keep.add(parent.id);
}

/** RFC 4180 quoting — only where a field needs it. */
const field = (v) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const header = "id,name,uic,db_id,lat,lon,country,time_zone,parent";
const lines = [...keep]
  .sort((a, b) => Number(a) - Number(b))
  .map((id) => {
    const r = byId.get(id);
    const parent = keep.has(r.parent_station_id) ? r.parent_station_id : "";
    return [
      r.id,
      r.name.trim(),
      r.uic,
      r.db_id,
      r.latitude,
      r.longitude,
      r.country,
      r.time_zone,
      parent,
    ]
      .map(field)
      .join(",");
  });

const csv = `${[header, ...lines].join("\n")}\n`;
fs.mkdirSync(path.dirname(target), { recursive: true });
// mtime 0 in the gzip header keeps the output byte-stable across rebuilds.
fs.writeFileSync(target, zlib.gzipSync(Buffer.from(csv, "utf-8"), { level: 9 }));
console.log(`${lines.length} stations → ${target} (${fs.statSync(target).size} bytes)`);
