import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { prisma } from "./db";
import logger from "./utils/logger";

interface CSVPort {
  name: string;
  city: string;
  country: string;
  unlocode: string;
  lat: string;
  lon: string;
  timezone: string;
  region: string;
}

const CSV_PATH = path.resolve(__dirname, "seedData", "ports.csv");
const INSERT_CHUNK_SIZE = 2000;

/**
 * Idempotent port seeder. Bulk pattern: one query loads existing UNLOCODEs,
 * then chunked `createMany` calls insert the new ones. Boot-time stays
 * sub-100ms once the catalog is fully seeded — there is nothing left to
 * insert, so only the lookup query runs (the previous per-row
 * findUnique+create scaled at ~3ms/row → multi-second boot delays once the
 * CSV grew past a few hundred entries).
 *
 * A fresh-DB seed is a different story: `ports.csv` is 12000+ rows now, and
 * a single unchunked `createMany` for all of them measured 2.5s idle /
 * 13-17s under the CPU contention four parallel PostGIS-backed Jest shards
 * produce on one CI runner (see seedPortsFromCSV.test.ts for the measurement
 * and the timeout it derives from it).
 *
 * `INSERT_CHUNK_SIZE` is a plain round number, not derived from Postgres's
 * per-statement bind limit — Prisma 7 already splits a `createMany` whose
 * bind values exceed that limit (32766 for postgresql) into several
 * statements wrapped in one transaction, and the unchunked call never came
 * close to it (12,062 rows × 9 columns = 108,558 params → 4 statements, all
 * inside that one transaction). Chunking below the limit trades that
 * wrapping transaction away: a failure partway through can now leave a
 * partial seed committed, where the old call rolled back whole. That's fine
 * here — both callers (`index.ts`, `init.ts`) warn and continue rather than
 * abort on a seed error, and the dedupe keys (unlocode, lowercase
 * name+country) mean the next boot just inserts whatever is still missing.
 * The measured ~10-20% speedup under contention most likely comes from
 * dropping that transaction wrapper, not from the chunk boundary itself.
 */
export async function seedPortsFromCSV(): Promise<number> {
  if (!fs.existsSync(CSV_PATH)) {
    logger.warn({ operation: "seed_ports_skip", reason: "csv_missing", path: CSV_PATH });
    return 0;
  }

  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CSVPort[];

  // Drop malformed rows up-front so we don't ship them to Prisma.
  const valid = rows.filter((r) => r.name && r.lat && r.lon);

  // One bulk lookup loads everything we need to dedupe against. We key by:
  //   - UNLOCODE (when set) — covers ~95% of seed rows
  //   - lowercase (name + country) — covers the remaining rows that have no
  //     UNLOCODE assigned (Polesella, Hellesylt, Goritsy, …). Without this
  //     fallback those rows get re-inserted on every boot.
  // User-added rows are preserved by both keys.
  const existing = await prisma.port.findMany({
    select: { unlocode: true, name: true, country: true },
  });
  const existingUnlocodes = new Set(
    existing.map((p) => p.unlocode).filter((u): u is string => Boolean(u))
  );
  const existingNameCountry = new Set(
    existing.map((p) => `${p.name.toLowerCase()}\x00${(p.country ?? "").toLowerCase()}`)
  );

  const toInsert = valid
    .filter((r) => {
      const code = r.unlocode?.trim();
      if (code && existingUnlocodes.has(code)) return false;
      const key = `${r.name.trim().toLowerCase()}\x00${(r.country?.trim() ?? "").toLowerCase()}`;
      if (existingNameCountry.has(key)) return false;
      return true;
    })
    .map((r) => ({
      name: r.name.trim(),
      city: r.city?.trim() || null,
      country: r.country?.trim() || null,
      unlocode: r.unlocode?.trim() || null,
      lat: Number.parseFloat(r.lat),
      lon: Number.parseFloat(r.lon),
      timezone: r.timezone?.trim() || null,
      region: r.region?.trim() || null,
      isUserAdded: false,
    }));

  if (toInsert.length === 0) {
    logger.info({ operation: "seed_ports_done", inserted: 0, total: valid.length });
    return 0;
  }

  // `skipDuplicates` is the safety net for rows without UNLOCODE that happen
  // to collide on some other unique index in the future, and for the race
  // where a concurrent insert creates the same unlocode between our findMany
  // and createMany. The pre-filter does the heavy lifting; this just keeps us
  // crash-free in edge cases.
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const result = await prisma.port.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  logger.info({
    operation: "seed_ports_done",
    inserted,
    skipped: valid.length - inserted,
    total: valid.length,
  });
  return inserted;
}
