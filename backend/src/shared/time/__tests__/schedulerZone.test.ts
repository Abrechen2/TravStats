import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Every cron job names its zone (ADR 0002 D4). node-cron reads an
 * expression in the HOST's zone otherwise, and the image runs with
 * `TZ=${TZ:-UTC}` — an instance that set `TZ` moved every "3 AM UTC" job.
 */

const SRC = path.resolve(__dirname, "../../..");
const BACKEND_ROOT = path.resolve(SRC, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "generated" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("cron jobs and their zones", () => {
  it("passes an explicit schedulerZone to every cron.schedule call", () => {
    // A source scan, so it ages with the call shape it reads: a job scheduled
    // through a wrapper would slip past. Today every job calls node-cron
    // directly, and this counts them.
    const offenders: string[] = [];
    let calls = 0;
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      const scheduled = text.split("cron.schedule(").length - 1;
      const zoned = (text.match(/\{\s*timezone:\s*schedulerZone\(/g) ?? []).length;
      calls += scheduled;
      if (scheduled !== zoned) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
    expect(calls).toBeGreaterThanOrEqual(14);
  });

  it("runs maintenance jobs in UTC", () => {
    const { schedulerZone } = require("../schedulerZone") as typeof import("../schedulerZone");
    expect(schedulerZone("airlineLogoRefresh")).toBe("UTC");
    expect(schedulerZone("statusSweep")).toBe("UTC");
  });

  it.each(["America/St_Johns", "Pacific/Kiritimati"])(
    "keeps the backup in the host's zone (%s), read once at boot",
    (tz) => {
      const script =
        'const s = require("./src/shared/time/schedulerZone");' +
        'const first = s.backupZone(); process.env.TZ = "UTC";' +
        'process.stdout.write(JSON.stringify({ first, again: s.schedulerZone("backup"), fixed: s.schedulerZone("statusSweep") }));';
      const out = execFileSync(
        process.execPath,
        [path.join(BACKEND_ROOT, "node_modules/tsx/dist/cli.mjs"), "-e", script],
        {
          cwd: BACKEND_ROOT,
          encoding: "utf8",
          env: { ...process.env, TZ: tz, LOG_LEVEL: "silent" },
        }
      );
      const line = out.trim().split("\n").pop() ?? "";
      expect(JSON.parse(line)).toEqual({
        first: { zone: tz, source: "host" },
        again: tz,
        fixed: "UTC",
      });
    },
    60_000
  );
});
