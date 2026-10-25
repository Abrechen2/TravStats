import { readdirSync, readFileSync } from "fs";
import path from "path";

import { prisma } from "../../../db";

/**
 * TravTrack in the backup (TravTrack plan T7). The backup is the whole
 * database as one `pg_dump`, so TravTrack's tables are in it as long as
 * nothing excludes them — pinned here on the dump's own source — and a
 * restore keeps the points' order only when the `seq` sequence travels with
 * its table: `pg_dump` writes `setval` for a sequence OWNED BY its column,
 * which is what a BIGSERIAL is.
 */

const BACKUP_DIR = path.join(__dirname, "..");
const sources = readdirSync(BACKUP_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, text: readFileSync(path.join(BACKUP_DIR, f), "utf8") }));

afterAll(async () => {
  await prisma.$disconnect();
});

describe("TravTrack in the backup", () => {
  it("no dump call excludes a table or narrows the dump to part of the database", () => {
    const narrowing =
      /--exclude-table|--exclude-table-data|--table\b|"-T"|"-t"|--schema-only|--data-only|travtrack_/;
    expect(sources.filter((s) => narrowing.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it("the points' seq sequence is owned by its column, so the dump restores it", async () => {
    const rows = await prisma.$queryRaw<Array<{ sequence: string | null }>>`
      SELECT pg_get_serial_sequence('travtrack_points', 'seq') AS sequence`;
    expect(rows[0].sequence).toMatch(/travtrack_points_seq_seq$/);
  });
});
