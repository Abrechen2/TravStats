import { describe, it, expect } from "@jest/globals";

import { withConnectionLimit } from "../../jest.setup";
import { WORKER_DB_ENV, workerDatabaseUrl } from "../../jest.workerDatabase";

/**
 * The harness that keeps this suite honest.
 *
 * Two failures cost real time in this project and neither looked like what it
 * was, so both are now handled by the harness rather than by remembering:
 *
 *  - An unreachable database used to fail every test on its own expectation.
 *    One run reported 1010 "failures" against a port with nothing behind it.
 *    `jest.globalSetup.ts` now refuses to start and says so in one sentence.
 *
 *  - Prisma's default pool is `cpus * 2 + 1` — 65 connections on this machine,
 *    against a Postgres allowing 100. With a dev server already connected the
 *    suite failed in three figures with timeouts and 40P01 deadlocks.
 *    `jest.setup.ts` caps it.
 *
 * The second assertion below observes the EFFECT in this very run rather than
 * restating the rule: if the setup file ever stops being wired into
 * `jest.config.js`, this fails.
 */
describe("test harness", () => {
  describe("withConnectionLimit", () => {
    it("adds a cap to a plain URL", () => {
      expect(withConnectionLimit("postgresql://u:p@localhost:5433/db")).toBe(
        "postgresql://u:p@localhost:5433/db?connection_limit=5"
      );
    });

    it("appends to a URL that already carries parameters", () => {
      expect(withConnectionLimit("postgresql://u:p@h/db?schema=public")).toBe(
        "postgresql://u:p@h/db?schema=public&connection_limit=5"
      );
    });

    it("leaves a chosen limit alone", () => {
      // Someone debugging pool behaviour must be able to override this without
      // their value being silently doubled up or replaced.
      const chosen = "postgresql://u:p@h/db?connection_limit=1";
      expect(withConnectionLimit(chosen)).toBe(chosen);
    });

    it("does not mistake another parameter ending in the same word", () => {
      const url = "postgresql://u:p@h/db?pool_connection_limit=99";
      expect(withConnectionLimit(url)).toBe(`${url}&connection_limit=5`);
    });
  });

  it("is actually wired in — this run is capped", () => {
    expect(process.env.DATABASE_URL).toMatch(/[?&]connection_limit=/);
  });

  /**
   * Each Jest worker gets a database of its own when the run is parallel.
   *
   * Twenty-four suites call `user.deleteMany()` with no filter and several more
   * empty whole catalogues. On one shared database, `--maxWorkers=4` let those
   * wipes land in the middle of other files: users vanished between a
   * registration and the next request (FK violations, 401 "user not found"),
   * and registration closed under a suite that expected to be the first user
   * (403). Measured on 2026-09-27: 51 of 791 suites red at 4 workers, and the
   * commit before the demo-seed merges was red the same way (42 of 779) — it
   * was never the merges, it was the shared database.
   */
  describe("workerDatabaseUrl", () => {
    it("gives each worker its own database name", () => {
      expect(workerDatabaseUrl("postgresql://u:p@localhost:5433/flights_test", 3)).toBe(
        "postgresql://u:p@localhost:5433/flights_test_w3"
      );
    });

    it("keeps the query string, including a chosen pool size", () => {
      expect(
        workerDatabaseUrl("postgresql://u:p@h:5432/db_test?schema=public&connection_limit=1", 2)
      ).toBe("postgresql://u:p@h:5432/db_test_w2?schema=public&connection_limit=1");
    });

    it("refuses a URL without a database name rather than guessing one", () => {
      expect(() => workerDatabaseUrl("postgresql://u:p@h:5432/", 1)).toThrow(/database name/);
    });
  });

  it("is actually wired in — a parallel run uses this worker's own database", () => {
    const perWorker = process.env[WORKER_DB_ENV] === "1";
    const name = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
    if (perWorker) {
      expect(name).toMatch(new RegExp(`_w${process.env.JEST_WORKER_ID}$`));
    } else {
      expect(name).not.toMatch(/_w\d+$/);
    }
  });
});
