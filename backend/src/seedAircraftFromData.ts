import fs from "fs";
import path from "path";
import { prisma } from "./db";
import { buildAircraftSeed } from "./data/openflights/buildAircraftSeed";
import logger from "./utils/logger";

const DATA_PATH = path.resolve(__dirname, "..", "data", "openflights", "planes.dat");

/**
 * Idempotent aircraft seeder. Bulk pattern (copied from seedPortsFromCSV):
 * one query loads existing ICAOs, one query inserts the new ones. Seeded
 * rows are isUserAdded:false; admin isUserAdded:true rows are matched by the
 * unique ICAO and never overwritten.
 */
export async function seedAircraftFromData(): Promise<number> {
  if (!fs.existsSync(DATA_PATH)) {
    logger.warn({ operation: "seed_aircraft_skip", reason: "data_missing", path: DATA_PATH });
    return 0;
  }

  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const seed = buildAircraftSeed(raw);

  const existing = await prisma.aircraft.findMany({ select: { icao: true } });
  const existingIcaos = new Set(
    existing.map((a) => a.icao).filter((i): i is string => Boolean(i)),
  );

  const toInsert = seed
    .filter((r) => !existingIcaos.has(r.icao))
    .map((r) => ({ icao: r.icao, name: r.name, isUserAdded: false }));

  if (toInsert.length === 0) {
    logger.info({ operation: "seed_aircraft_done", inserted: 0, total: seed.length });
    return 0;
  }

  const result = await prisma.aircraft.createMany({ data: toInsert, skipDuplicates: true });
  logger.info({
    operation: "seed_aircraft_done",
    inserted: result.count,
    skipped: seed.length - result.count,
    total: seed.length,
  });
  return result.count;
}
