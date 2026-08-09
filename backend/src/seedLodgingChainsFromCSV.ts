import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { prisma } from "./db";
import logger from "./utils/logger";

interface CSVLodgingChain {
  name: string;
  loyaltyProgram: string;
  brandColor: string;
}

const CSV_PATH = path.resolve(__dirname, "seedData", "lodging_chains.csv");

/**
 * Idempotent lodging-chain catalog seeder. `LodgingChain.name` is `@unique`,
 * so each row is written via a real `upsert` keyed on `name` — never a
 * hand-rolled findFirst-then-create, which would race under concurrent
 * boots. The `update` clause is intentionally empty: once a chain exists
 * (seeded or user-added) re-seeding never touches its fields again, mirroring
 * the ship/port catalog seeds.
 *
 * `name` uniqueness is case-sensitive at the database level ("Hilton" and
 * "hilton" are different keys), so a bulk case-insensitive pre-check runs
 * first: any CSV row whose name already exists under any casing is skipped
 * entirely rather than upserted, so a user who added "hilton" by hand never
 * ends up with a near-duplicate "Hilton" row after the next seed. This is a
 * seed-level mitigation, not a schema fix — a case-insensitive unique index
 * would be the complete fix and is out of scope here.
 */
export async function seedLodgingChainsFromCSV(): Promise<number> {
  if (!fs.existsSync(CSV_PATH)) {
    logger.warn({ operation: "seed_lodging_chains_skip", reason: "csv_missing", path: CSV_PATH });
    return 0;
  }

  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CSVLodgingChain[];

  const valid = rows.filter((r) => r.name && r.name.trim());
  const skipped = rows.length - valid.length;
  if (skipped > 0) {
    logger.warn({ operation: "seed_lodging_chains_malformed_rows", skipped });
  }

  const existing = await prisma.lodgingChain.findMany({ select: { name: true } });
  const existingLower = new Set(existing.map((c) => c.name.toLowerCase()));

  let inserted = 0;
  for (const row of valid) {
    const name = row.name.trim();
    if (existingLower.has(name.toLowerCase())) continue;

    await prisma.lodgingChain.upsert({
      where: { name },
      update: {},
      create: {
        name,
        loyaltyProgram: row.loyaltyProgram?.trim() || null,
        brandColor: row.brandColor?.trim() || null,
        isUserAdded: false,
      },
    });
    existingLower.add(name.toLowerCase());
    inserted += 1;
  }

  logger.info({ operation: "seed_lodging_chains_done", inserted, total: valid.length });
  return inserted;
}
