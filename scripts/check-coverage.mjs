#!/usr/bin/env node
/**
 * Coverage ratchet (forgejo#62).
 *
 * THE RULE
 *   Coverage of a tree may not fall below the figure recorded for it in
 *   coverage-baseline.json. It may rise freely; a rise prints a note asking for
 *   `--update`, the same way a shrinking file does in check-file-size.mjs.
 *
 * WHY NOT A FIXED NUMBER
 *   CLAUDE.md and the shared rules said "80% minimum" for months while nothing
 *   measured it, and both configs carried hard thresholds nobody had checked
 *   against a real run. A fixed floor far above the real figure produces one
 *   behaviour: tests for trivial getters, written to move a number. "Not worse
 *   than the last recorded run" rewards the thing actually wanted — new code
 *   arriving with tests — and can be tightened as the figure climbs.
 *
 * WHY A TOLERANCE
 *   The figure is not perfectly deterministic: a test that skips when a
 *   catalogue or a network answer is missing, or code reached only on a retry,
 *   moves it by a few hundredths. TOLERANCE absorbs that and nothing more — a
 *   real regression (an untested module landing) moves it by far more.
 *
 * USAGE
 *   node scripts/check-coverage.mjs <frontend|backend>            verify
 *   node scripts/check-coverage.mjs <frontend|backend> --update   record the
 *       current run; refuses to LOWER any figure, so the convenience path
 *       cannot loosen the ratchet
 *
 *   Reads <tree>/coverage/coverage-summary.json, which both test runners write
 *   with the `json-summary` reporter. When GITHUB_STEP_SUMMARY is set the
 *   figures are also published to the job summary — the first job of this
 *   ratchet is to make the number visible at all.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const BASELINE_PATH = join(SCRIPT_DIR, "coverage-baseline.json");

const TREES = ["frontend", "backend"];
const METRICS = ["lines", "statements", "functions", "branches"];
/** Percentage points a run may sit below the baseline without failing. */
const TOLERANCE = 0.25;

const round2 = (n) => Math.round(n * 100) / 100;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readSummary(tree) {
  const path = join(REPO_ROOT, tree, "coverage", "coverage-summary.json");
  if (!existsSync(path)) {
    fail(
      `No coverage summary at ${tree}/coverage/coverage-summary.json.\n` +
        `Run the ${tree} tests with coverage and the json-summary reporter first.`
    );
  }
  const total = JSON.parse(readFileSync(path, "utf8")).total;
  return Object.fromEntries(METRICS.map((m) => [m, round2(total[m].pct)]));
}

function readBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
}

function publish(tree, actual, recorded) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  const rows = METRICS.map(
    (m) => `| ${m} | ${actual[m].toFixed(2)} % | ${recorded ? `${recorded[m].toFixed(2)} %` : "—"} |`
  );
  appendFileSync(
    target,
    [`### Coverage — ${tree}`, "", "| metric | this run | baseline |", "|---|---|---|", ...rows, ""].join(
      "\n"
    ) + "\n"
  );
}

function main() {
  const [tree, ...flags] = process.argv.slice(2);
  if (!TREES.includes(tree)) fail(`Usage: check-coverage.mjs <${TREES.join("|")}> [--update]`);
  const update = flags.includes("--update");

  const actual = readSummary(tree);
  const baseline = readBaseline();
  const recorded = baseline[tree];
  publish(tree, actual, recorded);

  if (update) {
    const lowered = recorded ? METRICS.filter((m) => actual[m] < recorded[m]) : [];
    if (lowered.length > 0) {
      fail(
        `Refusing to lower the ${tree} baseline (${lowered
          .map((m) => `${m} ${recorded[m]} -> ${actual[m]}`)
          .join(", ")}).\nThe ratchet only tightens.`
      );
    }
    writeFileSync(BASELINE_PATH, JSON.stringify({ ...baseline, [tree]: actual }, null, 2) + "\n");
    console.log(`Baseline written for ${tree}: ${METRICS.map((m) => `${m} ${actual[m]}%`).join(", ")}`);
    return;
  }

  if (!recorded) fail(`No ${tree} entry in coverage-baseline.json. Record one with --update.`);

  const regressions = METRICS.filter((m) => actual[m] < recorded[m] - TOLERANCE);
  for (const m of METRICS) {
    console.log(`  ${m.padEnd(10)} ${actual[m].toFixed(2)} %   (baseline ${recorded[m].toFixed(2)} %)`);
  }
  if (regressions.length > 0) {
    fail(
      `\nFAIL: ${tree} coverage fell below its baseline by more than ${TOLERANCE} pp: ${regressions.join(", ")}.\n` +
        "New or changed code arrived without tests that reach it."
    );
  }
  const risen = METRICS.filter((m) => actual[m] > recorded[m] + TOLERANCE);
  if (risen.length > 0) {
    console.log(
      `\nNote: ${tree} coverage rose (${risen.join(", ")}). Run "node scripts/check-coverage.mjs ${tree} --update" to tighten the baseline.`
    );
  }
  console.log(`\nOK: ${tree} coverage is not below its baseline.`);
}

main();
