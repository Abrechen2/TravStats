import { execFileSync } from "child_process";
import path from "path";

/**
 * Phase 1 probe (plan, "Sequencing risks"): a `@db.Date` column must come
 * back as the day that was written, whatever the HOST zone. `pg`'s default
 * DATE parser builds a host-local midnight; had it been in adapter-pg's path,
 * every day column would read a day early east of UTC... and phase 3, which
 * moves the day columns to DATE, would have shipped that.
 *
 * Run in child processes because TZ cannot change inside a Jest worker. If
 * this ever fails, register a string parser for OID 1082 in
 * `prismaClient.ts` before any DATE column is read — and `fromDbDate`
 * already refuses the shifted value rather than reporting a neighbour day.
 */

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");
const TSX = path.join(BACKEND_ROOT, "node_modules/tsx/dist/cli.mjs");
const CLI = path.join(__dirname, "dbDateProbeCli.ts");

const DAY = "2027-05-02";
const MIDNIGHT = `${DAY}T00:00:00.000Z`;

describe.each(["UTC", "Pacific/Kiritimati", "America/St_Johns"])(
  "a DATE round trip with the host in %s",
  (tz) => {
    let output: Record<string, unknown>;

    beforeAll(() => {
      const out = execFileSync(process.execPath, [TSX, CLI], {
        cwd: BACKEND_ROOT,
        encoding: "utf8",
        env: { ...process.env, TZ: tz, LOG_LEVEL: "silent" },
      });
      output = JSON.parse(out.trim().split("\n").pop() ?? "{}");
    }, 90_000);

    it("really ran in that zone", () => {
      expect(output.hostZone).toBe(tz);
    });

    it.each(["literal", "param", "model"])(
      "reads the %s path as UTC midnight of the day",
      (key) => {
        expect(output[key]).toEqual({ iso: MIDNIGHT, day: DAY });
      }
    );
  }
);
