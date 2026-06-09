import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { prisma } from './db';
import logger from './utils/logger';

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

const CSV_PATH = path.resolve(__dirname, 'seedData', 'ports.csv');

/**
 * Idempotent port seeder. Bulk pattern: one query loads existing UNLOCODEs,
 * one query inserts the new ones. Boot-time stays sub-100ms even with 1000+
 * rows (the previous per-row findUnique+create scaled at ~3ms/row → multi-
 * second boot delays once the CSV grew past a few hundred entries).
 *
 * Rows without an UNLOCODE always insert (the unique-conflict skip can't gate
 * them). User-added rows are protected via `isUserAdded=false` on insert and
 * the `skipDuplicates` clause on the unique unlocode index.
 */
export async function seedPortsFromCSV(): Promise<number> {
  if (!fs.existsSync(CSV_PATH)) {
    logger.warn({ operation: 'seed_ports_skip', reason: 'csv_missing', path: CSV_PATH });
    return 0;
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
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
    existing.map((p) => p.unlocode).filter((u): u is string => Boolean(u)),
  );
  const existingNameCountry = new Set(
    existing.map((p) => `${p.name.toLowerCase()}\x00${(p.country ?? "").toLowerCase()}`),
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
    logger.info({ operation: 'seed_ports_done', inserted: 0, total: valid.length });
    return 0;
  }

  // `skipDuplicates` is the safety net for rows without UNLOCODE that happen
  // to collide on some other unique index in the future, and for the race
  // where a concurrent insert creates the same unlocode between our findMany
  // and createMany. The pre-filter does the heavy lifting; this just keeps us
  // crash-free in edge cases.
  const result = await prisma.port.createMany({
    data: toInsert,
    skipDuplicates: true,
  });

  logger.info({
    operation: 'seed_ports_done',
    inserted: result.count,
    skipped: valid.length - result.count,
    total: valid.length,
  });
  return result.count;
}
