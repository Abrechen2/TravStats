import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { AppError } from "../../../middleware/errorHandler";
import {
  MIGRATIONS_DIR,
  listLocalMigrations,
  migrationEpilogue,
  planArchiveMigrations,
  readArchiveSchema,
} from "../restoreMigrations";
import { MIGRATION_MARKER } from "../restorePsql";

/**
 * forgejo#157 — which version wrote an archive, read from its own
 * `_prisma_migrations`, and the SQL that brings an older one up to this
 * version inside the restore's transaction. The round trip against a real
 * database is `restoreOlderArchive.test.ts`; this pins the decisions.
 */

const COPY_HEADER =
  "COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;";

function dumpWith(rows: string[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restore-mig-")), "database.sql");
  fs.writeFileSync(
    file,
    [
      "SET statement_timeout = 0;",
      "COPY public.users (id, username) FROM stdin;",
      "u1\t20250101000000_not_a_migration",
      "\\.",
      COPY_HEADER,
      ...rows,
      "\\.",
      "",
    ].join("\n")
  );
  return file;
}

const row = (name: string, finished: string | null, rolledBack: string | null = null): string =>
  ["id", "sum", finished ?? "\\N", name, "\\N", rolledBack ?? "\\N", "2026-01-01", "1"].join("\t");

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("readArchiveSchema", () => {
  it("reads the applied and the unfinished migrations, and nothing from other tables", async () => {
    const dump = dumpWith([
      row("20250101000000_init", "2026-01-01"),
      row("20250201000000_second", "2026-01-02"),
      // Failed once, resolved as rolled back, then applied: applied.
      row("20250301000000_retried", null, "2026-01-03"),
      row("20250301000000_retried", "2026-01-04"),
      // Started and never finished: Prisma's P3009 state.
      row("20250401000000_stuck", null),
    ]);

    expect(await readArchiveSchema(dump)).toEqual({
      applied: ["20250101000000_init", "20250201000000_second", "20250301000000_retried"],
      unfinished: ["20250401000000_stuck"],
    });
  });

  it("answers null for a dump without a migration history", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restore-mig-")), "database.sql");
    fs.writeFileSync(file, "SELECT 1;\n");
    expect(await readArchiveSchema(file)).toBeNull();
  });
});

describe("planArchiveMigrations", () => {
  const local = ["20250101000000_a", "20250201000000_b", "20250301000000_c", "99999999999999_z"];

  it("returns this version's migrations the archive lacks, in order, gaps included", () => {
    expect(
      planArchiveMigrations(
        { applied: ["20250101000000_a", "99999999999999_z"], unfinished: [] },
        local
      )
    ).toEqual(["20250201000000_b", "20250301000000_c"]);
  });

  it("returns nothing for an archive written by this version", () => {
    expect(planArchiveMigrations({ applied: local, unfinished: [] }, local)).toEqual([]);
  });

  it("refuses an archive that knows a migration this version does not", () => {
    const error = refusal(() =>
      planArchiveMigrations({ applied: [...local, "29990101000000_future"], unfinished: [] }, local)
    );
    expect(error.code).toBe("RESTORE_ARCHIVE_NEWER");
    expect(error.message).toContain("29990101000000_future");
  });

  it("refuses an archive taken while a migration had failed", () => {
    const error = refusal(() =>
      planArchiveMigrations(
        { applied: ["20250101000000_a"], unfinished: ["20250201000000_b"] },
        local
      )
    );
    expect(error.code).toBe("RESTORE_ARCHIVE_FAILED_MIGRATION");
  });

  it("refuses an archive without a migration history", () => {
    expect(refusal(() => planArchiveMigrations(null, local)).code).toBe(
      "RESTORE_ARCHIVE_UNVERSIONED"
    );
  });
});

describe("migrationEpilogue", () => {
  it("is empty when nothing is pending, so a same-version restore is unchanged", () => {
    expect(migrationEpilogue([])).toBe("");
  });

  it("runs each migration in a fresh session, marked, and records it as Prisma does", () => {
    const [first, second] = listLocalMigrations(MIGRATIONS_DIR).slice(-2);
    const epilogue = migrationEpilogue([first, second]);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, second, "migration.sql"));

    expect(epilogue.startsWith("\nRESET ALL;\n")).toBe(true);
    expect(epilogue.indexOf(`${MIGRATION_MARKER}${first}`)).toBeLessThan(
      epilogue.indexOf(`${MIGRATION_MARKER}${second}`)
    );
    expect(epilogue).toContain(sql.toString("utf-8"));
    expect(epilogue).toContain(
      `'${createHash("sha256").update(sql).digest("hex")}', clock_timestamp(), '${second}', NULL, NULL, clock_timestamp(), 1);`
    );
    expect(epilogue.match(/^RESET ALL;$/gm)).toHaveLength(2);
  });

  it("refuses a name that is not a migration directory's", () => {
    expect(() => migrationEpilogue(["x'); DROP TABLE users; --"])).toThrow(/Unexpected migration/);
  });
});
