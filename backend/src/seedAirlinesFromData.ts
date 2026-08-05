import fs from "fs";
import path from "path";
import { prisma } from "./db";
import { buildAirlineSeed } from "./data/openflights/buildAirlineSeed";
import logger from "./utils/logger";

const DATA_PATH = path.resolve(__dirname, "..", "data", "openflights", "airlines.dat");

/**
 * Idempotent airline seeder. Bulk pattern (copied from seedPortsFromCSV):
 * one query loads existing IATAs, one query inserts the new ones. Seeded
 * rows are isUserAdded:false; admin isUserAdded:true rows are matched by the
 * unique IATA and never overwritten.
 */
export async function seedAirlinesFromData(): Promise<number> {
  if (!fs.existsSync(DATA_PATH)) {
    logger.warn({ operation: "seed_airlines_skip", reason: "data_missing", path: DATA_PATH });
    return 0;
  }

  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const seed = buildAirlineSeed(raw);

  const existing = await prisma.airline.findMany({ select: { iata: true } });
  const existingIatas = new Set(
    existing.map((a) => a.iata).filter((i): i is string => Boolean(i)),
  );

  const toInsert = seed
    .filter((r) => !existingIatas.has(r.iata))
    .map((r) => ({
      iata: r.iata,
      icao: r.icao,
      name: r.name,
      callsign: r.callsign,
      country: r.country,
      active: r.active,
      isUserAdded: false,
    }));

  if (toInsert.length === 0) {
    logger.info({ operation: "seed_airlines_done", inserted: 0, total: seed.length });
    return 0;
  }

  const result = await prisma.airline.createMany({ data: toInsert, skipDuplicates: true });
  logger.info({
    operation: "seed_airlines_done",
    inserted: result.count,
    skipped: seed.length - result.count,
    total: seed.length,
  });
  return result.count;
}
