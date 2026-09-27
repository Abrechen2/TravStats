import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

import { prisma } from "./db";
import { Prisma } from "./prisma";
import logger from "./utils/logger";

/**
 * The DB station codes ("Ril 100" / DS100 — KK for Köln Hbf) per EVA number,
 * built by `scripts/build-rail-station-codes.mjs` from OpenStation and
 * Wikidata (both CC0; provenance in data/rail/station_codes.SOURCES.md).
 * Resolved like the catalogue beside it: dist/ in the image, src/ in
 * development, both one level below backend/.
 */
export const RAIL_STATION_CODES_PATH = path.resolve(
  __dirname,
  "..",
  "data",
  "rail",
  "station_codes.csv"
);

/** An EVA number as the catalogue's `db_id` holds it. */
const EVA = /^\d{6,9}$/;
/** A Ril 100 code after the build script's first-token rule: letters and digits only. */
const CODE = /^[A-Z0-9]{1,8}$/;

export interface StationCodeFile {
  codes: Map<string, string>;
  rejected: number;
}

/**
 * Reads the table. A row that is not an EVA and a code is counted, not
 * silently dropped, and the first row for an EVA wins — the build script
 * writes one per EVA, so a second one is a hand edit, and it is reported.
 */
export function readStationCodes(csvPath: string): StationCodeFile {
  const rows = parse(fs.readFileSync(csvPath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<{ eva?: string; code?: string }>;
  const codes = new Map<string, string>();
  let rejected = 0;
  for (const row of rows) {
    const eva = row.eva ?? "";
    const code = (row.code ?? "").toUpperCase();
    if (!EVA.test(eva) || !CODE.test(code) || codes.has(eva)) {
      rejected += 1;
      continue;
    }
    codes.set(eva, code);
  }
  return { codes, rejected };
}

export type StationCodeSeedResult =
  | { status: "missing"; path: string }
  | { status: "applied"; updated: number; known: number; rejected: number };

/**
 * Writes each catalogue row's `short_code` from the table, matched on `db_id`.
 * Idempotent: one UPDATE that touches only rows whose code differs, so a boot
 * on an instance already carrying the codes changes nothing.
 *
 * Two things it deliberately does not do. It never touches a user-added row
 * (no source id) — that row is the user's. And it never CLEARS a code the file
 * no longer names: a thinner table (a source outage at build time) must not
 * empty a column that held good data.
 *
 * A missing file is a loud warning, not a quiet skip: without it every station
 * answers `shortCode: null`, which looks like "no code known" to every client.
 */
export async function seedRailStationCodes(
  csvPath: string = RAIL_STATION_CODES_PATH
): Promise<StationCodeSeedResult> {
  if (!fs.existsSync(csvPath)) {
    logger.warn({
      operation: "seed_rail_station_codes_missing",
      message:
        "Station short-code table is missing — every rail station will report shortCode null " +
        "until it is restored (backend/data/rail/station_codes.csv)",
      path: csvPath,
    });
    return { status: "missing", path: csvPath };
  }
  const { codes, rejected } = readStationCodes(csvPath);
  if (rejected > 0) {
    logger.warn({ operation: "seed_rail_station_codes_rejected_rows", rejected, path: csvPath });
  }
  const evas = [...codes.keys()];
  const values = evas.map((eva) => codes.get(eva) as string);
  const updated =
    evas.length === 0
      ? 0
      : await prisma.$executeRaw(Prisma.sql`
          UPDATE rail_stations AS s
          SET short_code = v.code
          FROM unnest(${evas}::text[], ${values}::text[]) AS v(eva, code)
          WHERE s.db_id = v.eva
            AND s.source_id IS NOT NULL
            AND s.short_code IS DISTINCT FROM v.code
        `);
  logger.info({
    operation: "seed_rail_station_codes_done",
    updated,
    known: codes.size,
    rejected,
  });
  return { status: "applied", updated, known: codes.size, rejected };
}
