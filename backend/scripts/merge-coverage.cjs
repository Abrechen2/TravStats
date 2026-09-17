#!/usr/bin/env node
/**
 * Merge the coverage of the sharded Jest jobs into one summary.
 *
 * CI splits the backend suite across parallel jobs (`jest --shard=i/n`), and
 * each job sees only its part of the suite. Every shard still reports EVERY
 * source file, because `collectCoverageFrom` names them all, so a file tested
 * in one shard shows as uncovered in the others. Adding the hit counts together
 * gives the figure a single serial run would have measured. Averaging the
 * shards' percentages would not.
 *
 * Usage: node scripts/merge-coverage.cjs <dir with coverage-final*.json> [out dir]
 * Writes <out dir>/coverage-summary.json (default `coverage/`), which is what
 * scripts/check-coverage.mjs reads.
 */

const fs = require("node:fs");
const path = require("node:path");
const libCoverage = require("istanbul-lib-coverage");
const libReport = require("istanbul-lib-report");
const reports = require("istanbul-reports");

const inputDir = process.argv[2];
const outDir = process.argv[3] ?? "coverage";
if (!inputDir) {
  console.error("usage: node scripts/merge-coverage.cjs <input dir> [out dir]");
  process.exit(2);
}

const files = fs
  .readdirSync(inputDir, { recursive: true })
  .map(String)
  .filter((name) => path.basename(name).startsWith("coverage-final") && name.endsWith(".json"));
if (files.length === 0) {
  console.error(`No coverage-final*.json under ${inputDir}. Did every shard upload its report?`);
  process.exit(1);
}

const map = libCoverage.createCoverageMap({});
for (const file of files) {
  map.merge(JSON.parse(fs.readFileSync(path.join(inputDir, file), "utf8")));
}

fs.mkdirSync(outDir, { recursive: true });
const context = libReport.createContext({ dir: outDir, coverageMap: map });
reports.create("json-summary").execute(context);
reports.create("text-summary").execute(context);
console.log(
  `Merged ${files.length} shard report(s) into ${path.join(outDir, "coverage-summary.json")}`
);
