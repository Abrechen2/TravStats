import { execFileSync } from "child_process";
import path from "path";
import type { VectorResult } from "./runVectors";

/**
 * The same vectors, with the HOST in UTC+14 and UTC−3:30 (ADR 0002 D6).
 *
 * A child process per zone, because `process.env.TZ` set inside a running
 * Jest worker does not change the zone the runtime already adopted. Each
 * child reports the zone it really ran in, so a platform that ignored `TZ`
 * fails here instead of passing on the default zone.
 */

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");
const TSX = path.join(BACKEND_ROOT, "node_modules/tsx/dist/cli.mjs");
const CLI = path.join(__dirname, "vectorsCli.ts");

interface CliOutput {
  hostZone: string;
  hostOffsetJanuary: number;
  results: VectorResult[];
}

function runUnder(tz: string): CliOutput {
  const out = execFileSync(process.execPath, [TSX, CLI], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    env: { ...process.env, TZ: tz, NODE_ENV: "test", LOG_LEVEL: "silent" },
  });
  const line = out.trim().split("\n").pop() ?? "";
  return JSON.parse(line) as CliOutput;
}

describe.each([
  // getTimezoneOffset is minutes WEST of UTC: +14:00 → −840, −03:30 → 210.
  ["Pacific/Kiritimati", -840],
  ["America/St_Johns", 210],
])("server vectors with the host in %s", (tz, expectedHostOffset) => {
  let output: CliOutput;

  beforeAll(() => {
    output = runUnder(tz);
  }, 90_000);

  it("really ran in that zone", () => {
    expect(output.hostZone).toBe(tz);
    expect(output.hostOffsetJanuary).toBe(expectedHostOffset);
  });

  it("passes every server case", () => {
    const failures = output.results.filter((r) => !r.ok);
    expect(failures).toEqual([]);
    expect(output.results.length).toBeGreaterThan(40);
  });
});
