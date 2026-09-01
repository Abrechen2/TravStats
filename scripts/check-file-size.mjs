#!/usr/bin/env node
/**
 * File-size ratchet.
 *
 * THE RULE
 *   Hand-written logic modules under backend/src and frontend/src may not exceed
 *   800 lines (the limit CLAUDE.md has documented all along). Files that are
 *   ALREADY over it are listed in file-size-baseline.json with the line count they
 *   had on the day the ratchet was introduced. Such a file:
 *     - may shrink freely,
 *     - may never grow past its recorded number,
 *     - must be dropped from the baseline once it reaches 800 or below.
 *   A leftover entry is a hard failure, so the list can only ever get shorter.
 *   A file that is not listed simply gets the full 800.
 *
 * WHY A BASELINE INSTEAD OF A REWRITE
 *   Enforcing the limit retroactively would mean splitting a few thousand lines
 *   across the largest modules in one go. That change is unreviewable in practice,
 *   and it would collide with every open feature branch, since the big files are
 *   exactly the ones under active development. Freezing the current sizes costs
 *   nothing, stops the bleeding immediately, and lets the numbers come down
 *   opportunistically: whoever is already editing one of these files pays a few
 *   lines of cleanup instead of a dedicated refactor nobody schedules.
 *
 * WHY NOT ESLINT max-lines
 *   ESLint has no notion of this baseline. Two mechanisms reporting the same
 *   violation would disagree the moment a file drops below its recorded count, so
 *   this script is the single owner of the rule.
 *
 * USAGE
 *   node scripts/check-file-size.mjs            verify (exit 0 green, 1 red)
 *   node scripts/check-file-size.mjs --update   rewrite the baseline; refuses to
 *                                               raise any existing entry, so even
 *                                               the convenience path cannot loosen
 *                                               the ratchet
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const BASELINE_PATH = join(SCRIPT_DIR, "file-size-baseline.json");

const LINE_LIMIT = 800;

/** Only hand-written sources are scanned; config and data trees are out of scope. */
const SCAN_ROOTS = ["backend/src", "frontend/src"];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Directory names that never contain hand-written logic worth measuring. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "generated",
  "__tests__",
]);

/**
 * Deliberate exclusions. A line count says nothing about these: a test file grows
 * with the number of cases it covers, and a seed script is a flat list of records.
 * Splitting either one to satisfy a threshold would make the code worse.
 */
function isExcluded(repoRelativePath) {
  if (/\.test\.tsx?$/.test(repoRelativePath)) return true;
  if (/^backend\/src\/seed[^/]*\.ts$/.test(repoRelativePath)) return true;
  return false;
}

/** Repo-relative, forward slashes — the baseline is read on Windows and Linux alike. */
function toRepoRelative(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join("/");
}

/**
 * Counts lines the way an editor shows them: a trailing newline terminates the
 * last line rather than starting an empty one.
 */
function countLines(absolutePath) {
  const content = readFileSync(absolutePath, "utf8");
  if (content === "") return 0;
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function collectSourceFiles(absoluteDir, collected) {
  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    // A scan root may legitimately be absent in a partial checkout.
    return collected;
  }

  for (const entry of entries) {
    const absolutePath = join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      collectSourceFiles(absolutePath, collected);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)))
      continue;

    const repoRelativePath = toRepoRelative(absolutePath);
    if (isExcluded(repoRelativePath)) continue;
    collected.set(repoRelativePath, countLines(absolutePath));
  }
  return collected;
}

function scanRepository() {
  const measured = new Map();
  for (const root of SCAN_ROOTS) {
    collectSourceFiles(join(REPO_ROOT, root), measured);
  }
  return measured;
}

function readBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE_PATH, "utf8");
  } catch {
    return {};
  }
  const parsed = JSON.parse(raw);
  return parsed.files ?? {};
}

/** Sorted largest first, so the file most worth splitting is the one you read first. */
function sortByCountDescending(files) {
  return Object.fromEntries(
    Object.entries(files).sort(([pathA, countA], [pathB, countB]) =>
      countA === countB ? pathA.localeCompare(pathB) : countB - countA,
    ),
  );
}

function writeBaseline(files) {
  const document = {
    $comment:
      "Generated by scripts/check-file-size.mjs. Files already over the 800-line limit, " +
      "frozen at their current size. Entries may shrink or disappear, never grow. " +
      "Do not add entries by hand.",
    limit: LINE_LIMIT,
    files: sortByCountDescending(files),
  };
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}

function verify(measured, baseline) {
  const overLimit = [];
  const grewPastBaseline = [];
  const staleEntries = [];
  const shrunkBelowBaseline = [];

  for (const [path, count] of measured) {
    const allowed = baseline[path];
    if (allowed === undefined) {
      if (count > LINE_LIMIT)
        overLimit.push({ path, count, allowed: LINE_LIMIT });
      continue;
    }
    if (count > allowed) {
      grewPastBaseline.push({ path, count, allowed });
    } else if (count <= LINE_LIMIT) {
      staleEntries.push({ path, count, allowed });
    } else if (count < allowed) {
      shrunkBelowBaseline.push({ path, count, allowed });
    }
  }

  // A baseline entry whose file is gone or is no longer scanned is stale too.
  for (const [path, allowed] of Object.entries(baseline)) {
    if (!measured.has(path)) staleEntries.push({ path, count: null, allowed });
  }

  return { overLimit, grewPastBaseline, staleEntries, shrunkBelowBaseline };
}

function reportFailures(title, remedy, findings) {
  if (findings.length === 0) return;
  console.error(`\n${title} (${findings.length})`);
  console.error(`  ${remedy}`);
  for (const { path, count, allowed } of findings) {
    const actual =
      count === null ? "file not found / no longer scanned" : `${count} lines`;
    console.error(
      `    ${path}\n      actual: ${actual}   allowed: ${allowed} lines`,
    );
  }
}

function main() {
  const shouldUpdate = process.argv.includes("--update");
  const measured = scanRepository();
  const baseline = readBaseline();

  if (shouldUpdate) {
    const next = {};
    const wouldRaise = [];
    for (const [path, count] of measured) {
      if (count <= LINE_LIMIT) continue;
      const allowed = baseline[path];
      if (allowed !== undefined && count > allowed) {
        wouldRaise.push({ path, count, allowed });
      }
      next[path] = count;
    }

    if (wouldRaise.length > 0) {
      reportFailures(
        "REFUSING TO UPDATE — these files grew past their baseline",
        "The baseline may only shrink. Bring the file back down instead of re-recording it.",
        wouldRaise,
      );
      console.error("\nBaseline left untouched.\n");
      return 1;
    }

    writeBaseline(next);
    console.log(
      `Baseline written: ${Object.keys(next).length} file(s) over the ${LINE_LIMIT}-line limit.`,
    );
    return 0;
  }

  const { overLimit, grewPastBaseline, staleEntries, shrunkBelowBaseline } =
    verify(measured, baseline);

  reportFailures(
    "OVER LIMIT — new file above the line limit",
    `Split it. Only files that predate the ratchet get a baseline entry; new ones do not.`,
    overLimit,
  );
  reportFailures(
    "GREW PAST BASELINE — file was already too long and got longer",
    "Keep it at or below its recorded size: put the addition in a new module, " +
      "or remove at least as many lines as you added.",
    grewPastBaseline,
  );
  reportFailures(
    "STALE BASELINE ENTRY — file is within the limit and must leave the list",
    `Run "npm run check:size -- --update" and commit the baseline. The list only shrinks.`,
    staleEntries,
  );

  const failureCount =
    overLimit.length + grewPastBaseline.length + staleEntries.length;
  if (failureCount > 0) {
    console.error(
      `\nFAIL: ${failureCount} file-size violation(s). Limit is ${LINE_LIMIT} lines.\n`,
    );
    return 1;
  }

  // Not a failure — a shrinking file is the ratchet working, it just needs recording.
  if (shrunkBelowBaseline.length > 0) {
    console.log(
      `Note: ${shrunkBelowBaseline.length} baselined file(s) shrank. ` +
        `Run "npm run check:size -- --update" to tighten the baseline.`,
    );
  }

  console.log(
    `OK: ${measured.size} source file(s) checked, ` +
      `${Object.keys(baseline).length} baselined at their frozen size, limit ${LINE_LIMIT}.`,
  );
  return 0;
}

process.exit(main());
