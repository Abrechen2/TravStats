import { describe, it, expect } from "@jest/globals";

import { withConnectionLimit } from "../../jest.setup";

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
});
