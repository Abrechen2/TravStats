import { execFileSync } from "child_process";
import path from "path";

/**
 * Provider times are a library boundary (ADR 0002 D6): Aviationstack sends an
 * airport's wall clock with no offset, AirLabs sometimes does. Each is
 * converted through `shared/time` right there, with the airport's zone from
 * the catalogue — and the answer may not depend on the SERVER's zone.
 *
 * Run in child processes with the host in UTC+14 and UTC−3:30, against the
 * seeded airport catalogue (FRA = Europe/Berlin, JFK = America/New_York).
 */

const BACKEND_ROOT = path.resolve(__dirname, "../..");
const TSX = path.join(BACKEND_ROOT, "node_modules/tsx/dist/cli.mjs");

const SCRIPT = `
const tz = require("./src/utils/timezone");
(async () => {
  const out = {
    hostZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    aviationstack: await tz.convertAviationstackTimeToUtc("2026-04-14 14:35", "FRA"),
    airlabsLocal: await tz.convertAirlabsTimeToUtc("2026-11-01 01:30", "JFK"),
    airlabsOffset: await tz.convertAirlabsTimeToUtc("2026-04-14T14:35:00+02:00", null),
    localToUtc: await tz.convertLocalTimeToUtc("2026-04-14T14:35:00", "FRA"),
    utcToLocal: await tz.convertUtcToLocalTime("2026-04-14T12:35:00Z", "FRA"),
    airlabsNoPlace: await tz.convertAirlabsTimeToUtc("2026-04-14 14:35", null).catch((e) => e.code),
  };
  process.stdout.write(JSON.stringify(out) + "\\n");
  process.exit(0);
})().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;

describe.each(["Pacific/Kiritimati", "America/St_Johns"])(
  "provider times with the host in %s",
  (tz) => {
    let out: Record<string, unknown>;

    beforeAll(() => {
      const raw = execFileSync(process.execPath, [TSX, "-e", SCRIPT], {
        cwd: BACKEND_ROOT,
        encoding: "utf8",
        env: { ...process.env, TZ: tz, LOG_LEVEL: "silent" },
      });
      out = JSON.parse(raw.trim().split("\n").pop() ?? "{}");
    }, 90_000);

    it("really ran in that zone", () => {
      expect(out.hostZone).toBe(tz);
    });

    it("reads an Aviationstack wall clock in the airport's zone", () => {
      // 14:35 in Frankfurt in April is CEST, +02:00.
      expect(out.aviationstack).toBe("2026-04-14T12:35:00.000Z");
      expect(out.localToUtc).toBe("2026-04-14T12:35:00.000Z");
    });

    it("takes the earlier occurrence of a repeated hour (Q5)", () => {
      // 01:30 on 2026-11-01 happens twice in New York; the first is EDT.
      expect(out.airlabsLocal).toBe("2026-11-01T05:30:00.000Z");
    });

    it("keeps an offset the provider sent", () => {
      expect(out.airlabsOffset).toBe("2026-04-14T12:35:00.000Z");
    });

    it("writes the airport's wall clock, not the host's", () => {
      expect(out.utcToLocal).toBe("2026-04-14T14:35:00.000Z");
    });

    it("refuses an offset-less time with no airport instead of reading it on the host clock", () => {
      expect(out.airlabsNoPlace).toBe("TZ_UNRESOLVED");
    });
  }
);
