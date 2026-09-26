import { execFileSync } from "child_process";
import path from "path";

/**
 * An imported spreadsheet is a library boundary (ADR 0002 D6): the client's
 * exceljs hands the server strings, and `new Date(v)` read an offset-less
 * date-time in the SERVER's zone. The same file imported on a host in UTC+14
 * put a 23:30 visit on the previous day. Run in child processes, because the
 * host zone cannot change inside a Jest worker.
 */

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");
const TSX = path.join(BACKEND_ROOT, "node_modules/tsx/dist/cli.mjs");

const SCRIPT = `
const c = require("./src/services/xlsxImport/cells");
process.stdout.write(JSON.stringify({
  hostZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  dateFromDateTime: c.isoDate("2024-04-03 23:30"),
  timestamp: c.isoTimestamp("2025-07-10T23:30"),
  dateTime: c.isoDateTime("2025-07-10 23:30:15"),
  withZ: c.isoTimestamp("2025-07-10T12:00:00.000Z"),
  withOffset: c.isoDateTime("2025-07-10T12:00:00+02:00"),
  bareDate: c.isoTimestamp("2025-07-10"),
}) + "\\n");
`;

describe.each(["UTC", "Pacific/Kiritimati", "America/St_Johns"])(
  "spreadsheet date cells with the host in %s",
  (tz) => {
    let out: Record<string, unknown>;

    beforeAll(() => {
      const raw = execFileSync(process.execPath, [TSX, "-e", SCRIPT], {
        cwd: BACKEND_ROOT,
        encoding: "utf8",
        env: { ...process.env, TZ: tz, LOG_LEVEL: "silent" },
      });
      out = JSON.parse(raw.trim().split("\n").pop() ?? "{}");
    }, 60_000);

    it("really ran in that zone", () => {
      expect(out.hostZone).toBe(tz);
    });

    it("reads an offset-less date-time the same on every host", () => {
      expect(out).toMatchObject({
        dateFromDateTime: "2024-04-03",
        timestamp: "2025-07-10T23:30:00.000Z",
        dateTime: "2025-07-10T23:30:15.000Z",
      });
    });

    it("keeps an explicit Z or offset, and a bare date as midnight", () => {
      expect(out).toMatchObject({
        withZ: "2025-07-10T12:00:00.000Z",
        withOffset: "2025-07-10T10:00:00.000Z",
        bareDate: "2025-07-10T00:00:00.000Z",
      });
    });
  }
);
