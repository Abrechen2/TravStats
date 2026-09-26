#!/usr/bin/env node
/**
 * Odd-zone test ratchet (ADR 0002, D6; time-model plan, phase 1).
 *
 * THE RULE
 *   CI runs the backend and web suites a second time with the host in
 *   Pacific/Kiritimati (UTC+14) and America/St_Johns (UTC-3:30). A test whose
 *   verdict depends on the host zone turns red there. The tests that are red
 *   there TODAY are listed in tz-failures-baseline.json; this script fails when
 *   a run shows a failure that is not listed (a NEW host-zone dependency) and
 *   when a listed test now passes (a STALE entry — take it off the list). The
 *   list can only shrink, and phase 4 of the plan takes it to empty.
 *
 * WHY A LIST AND NOT "ALL GREEN"
 *   The suites were written on hosts in UTC and Europe/Berlin and have never
 *   run anywhere else. Requiring them green under +14 on day one would mean
 *   either a red job everyone learns to ignore, or a job that is not wired. A
 *   frozen list makes the job required from the first day and still catches
 *   every new offender.
 *
 * SHARDS
 *   The backend suite runs in shards, and one shard only knows the files it
 *   ran. So a listed test is judged stale only when its file ran in the
 *   reports given (or no longer exists at all); a listed test in a file this
 *   shard did not run is not this shard's business.
 *
 * TEST IDS
 *   `<file relative to the tree>::<full test name>`, or `<file>::<suite>` when
 *   the file failed as a whole (it did not load, or a hook threw).
 *
 * USAGE
 *   node scripts/check-tz-ratchet.mjs <backend|frontend> <zone> <report.json>...
 *       verify one zone's run; reports are Jest `--json` / Vitest `json`
 *       reporter output (the same shape)
 *   node scripts/check-tz-ratchet.mjs <tree> <zone> --update <report.json>...
 *       remove stale entries for that zone; never adds one
 *   node scripts/check-tz-ratchet.mjs <tree> <zone> --record <report.json>...
 *       write the list for a zone that has none yet (the first run); refuses
 *       a zone already listed, so it cannot be used to widen a list
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
// Overridable for this script's own tests only; CI always uses the file here.
export const BASELINE_PATH =
  process.env.TZ_RATCHET_BASELINE ?? join(SCRIPT_DIR, "tz-failures-baseline.json");

export const TREES = ["backend", "frontend"];
export const ZONES = ["Pacific/Kiritimati", "America/St_Johns"];
const SUITE_MARKER = "<suite>";

const toPosix = (p) => p.split("\\").join("/");

/**
 * A report's file path, relative to its tree, with forward slashes. Runners
 * write absolute paths of the machine they ran on, which is the machine this
 * script runs on.
 */
export function relativeTestFile(file, treeRoot) {
  return toPosix(isAbsolute(file) ? relative(treeRoot, file) : file);
}

/**
 * The files a report ran and the tests that failed in it. Throws on a report
 * that ran nothing — a crashed runner must not read as "no failures".
 */
export function readRun(report, treeRoot) {
  const results = Array.isArray(report?.testResults) ? report.testResults : null;
  if (!results || results.length === 0) {
    throw new Error("The report ran no test files; the runner did not finish.");
  }
  const ran = new Set();
  const failed = new Set();
  for (const suite of results) {
    const file = relativeTestFile(suite.name, treeRoot);
    ran.add(file);
    const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
    const failedTests = assertions.filter((a) => a.status === "failed");
    for (const a of failedTests) {
      failed.add(`${file}::${a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(" ")}`);
    }
    if (suite.status === "failed" && failedTests.length === 0) {
      failed.add(`${file}::${SUITE_MARKER}`);
    }
  }
  return { ran, failed };
}

/** New failures, and listed entries that no longer fail where they could be judged. */
export function compareRun(listed, run, fileExists) {
  const listedSet = new Set(listed);
  const newFailures = [...run.failed].filter((id) => !listedSet.has(id)).sort();
  const stale = listed
    .filter((id) => {
      const file = id.slice(0, id.indexOf("::"));
      if (!fileExists(file)) return true;
      return run.ran.has(file) && !run.failed.has(id);
    })
    .sort();
  return { newFailures, stale };
}

export function mergeRuns(runs) {
  const ran = new Set();
  const failed = new Set();
  for (const r of runs) {
    r.ran.forEach((f) => ran.add(f));
    r.failed.forEach((f) => failed.add(f));
  }
  return { ran, failed };
}

function readBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
}

function writeBaseline(baseline) {
  const ordered = {};
  for (const tree of TREES) {
    if (!baseline[tree]) continue;
    ordered[tree] = {};
    for (const zone of Object.keys(baseline[tree]).sort()) {
      ordered[tree][zone] = [...baseline[tree][zone]].sort();
    }
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`);
}

function publish(tree, zone, run, listed, result) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  const lines = [
    `### Odd-zone ratchet — ${tree} under \`TZ=${zone}\``,
    "",
    `Files run: ${run.ran.size} · failing: ${run.failed.size} · listed: ${listed.length}` +
      ` · new: ${result.newFailures.length} · stale: ${result.stale.length}`,
    "",
    ...result.newFailures.map((id) => `- NEW: \`${id}\``),
    ...result.stale.map((id) => `- STALE: \`${id}\``),
    "",
  ];
  appendFileSync(target, `${lines.join("\n")}\n`);
}

function main(argv) {
  const [tree, zone, ...rest] = argv;
  if (!TREES.includes(tree) || !ZONES.includes(zone)) {
    console.error(
      `usage: check-tz-ratchet.mjs <${TREES.join("|")}> <${ZONES.join("|")}> [--update|--record] <report.json>...`
    );
    return 2;
  }
  const mode = rest[0] === "--update" || rest[0] === "--record" ? rest.shift() : "verify";
  if (rest.length === 0) {
    console.error("No report given.");
    return 2;
  }
  const treeRoot = join(REPO_ROOT, tree);
  const runs = rest.map((path) => {
    if (!existsSync(path)) throw new Error(`No report at ${path}: the test run did not write one.`);
    return readRun(JSON.parse(readFileSync(path, "utf8")), treeRoot);
  });
  const run = mergeRuns(runs);
  const baseline = readBaseline();
  const listed = baseline[tree]?.[zone];
  const fileExists = (file) => existsSync(join(treeRoot, file));

  if (mode === "--record") {
    if (listed) {
      console.error(`${tree} already has a list for ${zone}; --record only writes a first one.`);
      return 1;
    }
    baseline[tree] = { ...(baseline[tree] ?? {}), [zone]: [...run.failed] };
    writeBaseline(baseline);
    console.log(`Recorded ${run.failed.size} failing tests for ${tree} under ${zone}.`);
    return 0;
  }
  if (!listed) {
    console.error(`No list for ${tree} under ${zone} in tz-failures-baseline.json; run --record.`);
    return 1;
  }

  const result = compareRun(listed, run, fileExists);
  publish(tree, zone, run, listed, result);

  if (mode === "--update") {
    if (result.newFailures.length > 0) {
      console.error("--update only removes stale entries; these new failures must be fixed:");
      result.newFailures.forEach((id) => console.error(`  ${id}`));
      return 1;
    }
    const staleSet = new Set(result.stale);
    baseline[tree][zone] = listed.filter((id) => !staleSet.has(id));
    writeBaseline(baseline);
    console.log(`Removed ${result.stale.length} stale entries for ${tree} under ${zone}.`);
    return 0;
  }

  if (result.newFailures.length === 0 && result.stale.length === 0) {
    console.log(
      `${tree} under ${zone}: ${run.failed.size} failing, all listed (${listed.length} listed).`
    );
    return 0;
  }
  if (result.newFailures.length > 0) {
    console.error(`${tree} under TZ=${zone}: ${result.newFailures.length} NEW failure(s).`);
    console.error(
      "A result that depends on the host's zone. Fix the code (shared/time), not the list:"
    );
    result.newFailures.forEach((id) => console.error(`  ${id}`));
  }
  if (result.stale.length > 0) {
    console.error(`${tree} under TZ=${zone}: ${result.stale.length} listed test(s) now pass.`);
    console.error(
      `Take them off the list: node scripts/check-tz-ratchet.mjs ${tree} ${zone} --update <reports>`
    );
    result.stale.forEach((id) => console.error(`  ${id}`));
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
