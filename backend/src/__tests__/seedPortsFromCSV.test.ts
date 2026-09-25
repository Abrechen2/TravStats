import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { prisma } from "../db";
import { seedPortsFromCSV } from "../seedPortsFromCSV";

/**
 * `ports.csv` is 12000+ rows, and every test below runs at least one
 * fresh-DB seed of all of them — that's real work, not a fixture load, and
 * it does not fit Jest's 5s default under load.
 *
 * Measured on a 12-core box (ABRA-25): a fresh seed (findMany + chunked
 * createMany, INSERT_CHUNK_SIZE=2000) took 2.5s idle. Reproducing the CI
 * failure's actual contention — 4 parallel Jest processes each seeding
 * their own DB, competing for CPU the way 4 PostGIS-backed shards do on an
 * 8-core runner — pushed a single run to 13-17s. PR #129 (backend split
 * into 4 shards) hit exactly that: this suite's first test took ~20s
 * against the pre-chunking `createMany`, over the 5s default. 30s keeps
 * comfortable headroom above the worst measured run without leaving the
 * timeout effectively unbounded.
 */
const SEED_TEST_TIMEOUT_MS = 30000;

describe("seedPortsFromCSV", () => {
  beforeEach(async () => {
    // Wipe ALL rows (incl. isUserAdded) so each test starts clean. The
    // isUserAdded test below relies on Hamburg not pre-existing.
    await prisma.port.deleteMany({});
  });

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
      const count = await seedPortsFromCSV();
      expect(count).toBeGreaterThanOrEqual(50);
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
