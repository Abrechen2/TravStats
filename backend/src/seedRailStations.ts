import fs from "fs";
import path from "path";
import zlib from "zlib";
import { parse } from "csv-parse/sync";

import { prisma } from "./db";
import { foldStationName } from "./services/rail/railStations";
import logger from "./utils/logger";

/**
 * The vendored rail station catalogue — Trainline stations.csv, filtered by
 * `scripts/build-rail-stations.mjs`, ODbL 1.0 (see data/rail/LICENSE.txt).
 * Resolved from dist/ in the image and from src/ in development, both one
 * level below backend/, where the Dockerfile copies data/rail/.
 */
export const RAIL_STATIONS_PATH = path.resolve(__dirname, "..", "data", "rail", "stations.csv.gz");

interface CSVStation {
  id: string;
  name: string;
  uic: string;
  db_id: string;
  lat: string;
  lon: string;
  country: string;
  time_zone: string;
  parent: string;
}

const BATCH = 5_000;

const orNull = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Idempotent seeder, the ports/ships pattern: one query loads the source ids
 * already present, then only MISSING rows are inserted, in batches. Nothing is
 * ever updated — a row already in the table keeps whatever it holds, and a
 * user-added row (`isUserAdded`, no source id) is out of reach entirely. A
 * boot on a seeded instance therefore costs one read of the file and one
 * query.
 */
export async function seedRailStations(csvPath: string = RAIL_STATIONS_PATH): Promise<number> {
  if (!fs.existsSync(csvPath)) {
    logger.warn({ operation: "seed_rail_stations_skip", reason: "file_missing", path: csvPath });
    return 0;
  }
  const raw = zlib.gunzipSync(fs.readFileSync(csvPath)).toString("utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true }) as CSVStation[];

  const valid = rows.filter(
    (r) =>
      r.id &&
      r.name?.trim() &&
      Number.isFinite(Number.parseFloat(r.lat)) &&
      Number.isFinite(Number.parseFloat(r.lon))
  );

  const existing = await prisma.railStation.findMany({
    where: { sourceId: { not: null } },
    select: { sourceId: true },
  });
  const present = new Set(existing.map((s) => s.sourceId));

  const toInsert = valid
    .filter((r) => !present.has(r.id))
    .map((r) => ({
      sourceId: r.id,
      name: r.name.trim(),
      searchName: foldStationName(r.name),
      uic: orNull(r.uic),
      dbId: orNull(r.db_id),
      lat: Number.parseFloat(r.lat),
      lon: Number.parseFloat(r.lon),
      country: orNull(r.country)?.toUpperCase() ?? null,
      timezone: orNull(r.time_zone),
      parentSourceId: orNull(r.parent),
      isUserAdded: false,
    }));

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    // skipDuplicates covers a concurrent boot inserting the same source id
    // between our read and this write; the pre-filter does the real work.
    const result = await prisma.railStation.createMany({
      data: toInsert.slice(i, i + BATCH),
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  logger.info({
    operation: "seed_rail_stations_done",
    inserted,
    skipped: valid.length - inserted,
    total: valid.length,
  });
  return inserted;
}
