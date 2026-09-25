import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { prisma } from "../db";
import { seedPortsFromCSV } from "../seedPortsFromCSV";

const CSV_PATH = path.resolve(__dirname, "..", "seedData", "ports.csv");

// Independent of seedPortsFromCSV's own filtering, so a regression in that
// filtering (or in the chunked insert loop) can't hide behind a shared count.
function countValidCsvRows(): number {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Array<{
    name: string;
    lat: string;
    lon: string;
  }>;
  return rows.filter((r) => r.name && r.lat && r.lon).length;
}

/**
 * `ports.csv` is 12000+ rows, and every test below runs at least one
 * fresh-DB seed of all of them — that's real work, not a fixture load, and
 * it does not fit Jest's 5s default under load.
 *
 * Measured on a 12-core box (ABRA-25): a fresh seed (findMany + chunked
 * createMany, INSERT_CHUNK_SIZE=2000) took 2.5s idle. Reproducing the CI
 * failure's actual contention — 4 parallel Jest processes each seeding
 * their own DB, competing for CPU the way 4 PostGIS-backed shards do on an
 * 8-core runner — pushed a single run to 13-17s before this fix, and
 * 6.2-6.7s per test after it (3/3 passing), which is the number 30s
 * actually keeps headroom above. The pre-fix ceiling came from the
 * then-unmerged forgejo#129 (backend Jest split into 4 shards): its run hit this
 * suite's first test at ~20s against the pre-chunking `createMany`, over
 * the 5s default.
 */
const SEED_TEST_TIMEOUT_MS = 30000;

describe("seedPortsFromCSV", () => {
  beforeEach(async () => {
    // Wipe ALL rows (incl. isUserAdded) so each test starts clean. The
    // isUserAdded test below relies on Hamburg not pre-existing. Same
    // fresh-DB deleteMany cost as the seed itself, so it needs the same
    // timeout — Jest's per-test duration excludes beforeEach, so leaving
    // this on the 5s default would reopen the exact failure this PR fixes.
    await prisma.port.deleteMany({});
  }, SEED_TEST_TIMEOUT_MS);

  afterAll(async () => {
    // Leave the dev DB populated with the real seed data so other
    // workflows (dev server, manual smoke tests) see the expected catalog.
    // Same fresh-DB seed cost as the tests above, so it gets the same timeout.
    await prisma.port.deleteMany({});
    await seedPortsFromCSV();
    await prisma.$disconnect();
  }, SEED_TEST_TIMEOUT_MS);

  it(
    "inserts all rows from the CSV on a fresh DB",
    async () => {
      // `>= 50` used to be the whole assertion here, which a chunking bug that
      // dropped all but the first INSERT_CHUNK_SIZE rows would still clear —
      // the title says "all rows", so the count needs to be checked against
      // the actual CSV, not a number that was already true for a fixture.
      const validRowCount = countValidCsvRows();
      const count = await seedPortsFromCSV();
      // 3 of 12,062 rows repeat a UNLOCODE within the CSV itself and are dropped
      // by skipDuplicates against ports_unlocode_key - the table's only unique
      // index. (76 rows repeat (name, country); those are all inserted, because
      // that pair is deduped against rows already in the DB, not by an index.)
      expect(count).toBeGreaterThan(validRowCount * 0.99);
      expect(count).toBeLessThanOrEqual(validRowCount);
      const rows = await prisma.port.count();
      expect(rows).toBe(count);
    },
    SEED_TEST_TIMEOUT_MS
  );

  it(
    "is idempotent — running twice does not duplicate rows",
    async () => {
      const first = await seedPortsFromCSV();
      const second = await seedPortsFromCSV();
      expect(second).toBe(0);
      const rows = await prisma.port.count();
      expect(rows).toBe(first);
    },
    SEED_TEST_TIMEOUT_MS
  );

  it(
    "does not overwrite rows flagged isUserAdded",
    async () => {
      const p = await prisma.port.create({
        data: {
          name: "Hamburg",
          city: "Hamburg",
          country: "Germany",
          unlocode: "DEHAM",
          lat: 0,
          lon: 0,
          isUserAdded: true,
        },
      });
      await seedPortsFromCSV();
      const reloaded = await prisma.port.findUnique({ where: { id: p.id } });
      expect(reloaded?.lat).toBe(0);
      expect(reloaded?.isUserAdded).toBe(true);
    },
    SEED_TEST_TIMEOUT_MS
  );
});
