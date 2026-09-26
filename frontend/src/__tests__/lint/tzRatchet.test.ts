/**
 * scripts/check-tz-ratchet.mjs — the list of tests that are red when the host
 * runs in Pacific/Kiritimati or America/St_Johns (ADR 0002, D6).
 *
 * Pinned through the real CLI against a throwaway baseline: a run with an
 * unlisted failure fails, a run in which a listed test passes fails (stale),
 * a matching run passes, a report that ran nothing fails instead of reading
 * as "no failures", and a listed test in a file this shard did not run is not
 * judged. `--update` only removes, `--record` only writes a first list.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareRun, readRun } from "../../../../scripts/check-tz-ratchet.mjs";

const REPO = resolve(__dirname, "../../../..");
const SCRIPT = join(REPO, "scripts", "check-tz-ratchet.mjs");
const FRONTEND = join(REPO, "frontend");
const ZONE = "Pacific/Kiritimati";
const work = mkdtempSync(join(tmpdir(), "tz-ratchet-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// Real files, so the "file no longer exists" branch does not fire by accident.
const FILE_A = "src/shared/time/__tests__/time.test.ts";
const FILE_B = "src/shared/time/__tests__/vectors.test.ts";

interface Assertion {
  fullName: string;
  status: "passed" | "failed";
}

function report(files: Record<string, Assertion[] | "crashed">): object {
  return {
    testResults: Object.entries(files).map(([file, assertions]) =>
      assertions === "crashed"
        ? { name: join(FRONTEND, file), status: "failed", assertionResults: [] }
        : {
            name: join(FRONTEND, file),
            status: assertions.some((a) => a.status === "failed") ? "failed" : "passed",
            assertionResults: assertions,
          }
    ),
  };
}

let seq = 0;
function cli(
  listed: string[] | null,
  runReport: object,
  flag?: "--update" | "--record"
): { status: number | null; out: string; baseline: Record<string, Record<string, string[]>> } {
  seq += 1;
  const baselinePath = join(work, `baseline-${seq}.json`);
  const reportPath = join(work, `report-${seq}.json`);
  writeFileSync(baselinePath, JSON.stringify(listed ? { frontend: { [ZONE]: listed } } : {}));
  writeFileSync(reportPath, JSON.stringify(runReport));
  const args = [SCRIPT, "frontend", ZONE, ...(flag ? [flag] : []), reportPath];
  const run = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, TZ_RATCHET_BASELINE: baselinePath, GITHUB_STEP_SUMMARY: "" },
  });
  return {
    status: run.status,
    out: `${run.stdout}${run.stderr}`,
    baseline: JSON.parse(readFileSync(baselinePath, "utf8")),
  };
}

const failA = { fullName: "a breaks at midnight", status: "failed" } as const;
const passA = { fullName: "a breaks at midnight", status: "passed" } as const;
const failA2 = { fullName: "a reads the host", status: "failed" } as const;
const idA = `${FILE_A}::a breaks at midnight`;

describe("check-tz-ratchet", () => {
  it("passes a run whose failures are exactly the listed ones (control)", () => {
    const r = cli([idA], report({ [FILE_A]: [failA] }));
    expect(r.out).toContain("all listed");
    expect(r.status).toBe(0);
  });

  it("fails on a failure that is not listed", () => {
    const r = cli([idA], report({ [FILE_A]: [failA, failA2] }));
    expect(r.status).toBe(1);
    expect(r.out).toContain(`${FILE_A}::a reads the host`);
    expect(r.out).toMatch(/NEW failure/);
  });

  it("fails on a listed test that now passes (stale)", () => {
    const r = cli([idA], report({ [FILE_A]: [passA] }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/now pass/);
  });

  it("does not judge a listed test whose file another shard ran", () => {
    const r = cli([idA], report({ [FILE_B]: [{ fullName: "b", status: "passed" }] }));
    expect(r.status).toBe(0);
  });

  it("calls an entry for a deleted file stale", () => {
    const r = cli(["src/gone.test.ts::x"], report({ [FILE_A]: [passA] }));
    expect(r.status).toBe(1);
    expect(r.out).toContain("src/gone.test.ts::x");
  });

  it("names a file that failed as a whole", () => {
    const r = cli([], report({ [FILE_B]: "crashed" }));
    expect(r.status).toBe(1);
    expect(r.out).toContain(`${FILE_B}::<suite>`);
  });

  it("refuses a report that ran nothing", () => {
    const r = cli([idA], { testResults: [] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/ran no test files/);
  });

  it("--update removes stale entries and refuses to add new failures", () => {
    const pruned = cli([idA], report({ [FILE_A]: [passA] }), "--update");
    expect(pruned.status).toBe(0);
    expect(pruned.baseline.frontend[ZONE]).toEqual([]);
    const widened = cli([idA], report({ [FILE_A]: [failA, failA2] }), "--update");
    expect(widened.status).toBe(1);
    expect(widened.baseline.frontend[ZONE]).toEqual([idA]);
  });

  it("--record writes a first list and refuses to overwrite one", () => {
    const first = cli(null, report({ [FILE_A]: [failA] }), "--record");
    expect(first.status).toBe(0);
    expect(first.baseline.frontend[ZONE]).toEqual([idA]);
    const again = cli([], report({ [FILE_A]: [failA] }), "--record");
    expect(again.status).toBe(1);
  });

  it("reads Jest/Vitest reports into file-relative ids", () => {
    const run = readRun(report({ [FILE_A]: [failA, passA] }), FRONTEND);
    expect([...run.ran]).toEqual([FILE_A]);
    expect([...run.failed]).toEqual([idA]);
    expect(compareRun([idA], run, () => true)).toEqual({ newFailures: [], stale: [] });
  });
});
