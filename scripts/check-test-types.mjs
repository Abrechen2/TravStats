#!/usr/bin/env node
/**
 * Typecheck backend tests without slowing down Jest's isolated transpilation.
 * Existing test-only diagnostics are recorded individually. New diagnostics,
 * broken dependencies and production-code errors fail. --update can only
 * remove resolved diagnostics; it cannot record new debt.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(resolve(ROOT, "backend/package.json"))("typescript");
const BASELINE = resolve(ROOT, "scripts/test-types-baseline.json");
const posix = (value) => value.replaceAll("\\", "/");

export function diagnosticKey(entry) {
  // Source text distinguishes different failing expressions; line numbers do
  // not, because adding a comment must not invalidate the entire baseline.
  return createHash("sha256")
    .update(JSON.stringify([entry.file, entry.code, entry.message, entry.source]))
    .digest("hex");
}

export function compareDiagnostics(actual, recorded) {
  const remaining = new Map(recorded.map((entry) => [diagnosticKey(entry), entry.count]));
  const added = [];
  for (const entry of actual) {
    const key = diagnosticKey(entry);
    const allowed = remaining.get(key) ?? 0;
    if (entry.count > allowed) added.push({ ...entry, count: entry.count - allowed });
    remaining.set(key, Math.max(0, allowed - entry.count));
  }
  const resolved = recorded.flatMap((entry) => {
    const count = remaining.get(diagnosticKey(entry)) ?? 0;
    return count > 0 ? [{ ...entry, count }] : [];
  });
  return { added, resolved };
}

export function collectTestDiagnostics(root = ROOT) {
  const configPath = resolve(root, "backend/tsconfig.tests.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath
  );
  if (parsed.errors.length) {
    throw new Error(
      parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n")
    );
  }
  const testFiles = parsed.fileNames.filter((file) => /\.(test|spec)\.ts$/.test(file));
  if (testFiles.length === 0) throw new Error("The test typecheck selected no test files.");
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  const entries = new Map();
  const fatal = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const file = diagnostic.file ? posix(relative(root, diagnostic.file.fileName)) : "<config>";
    const message = posix(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .replaceAll(posix(root), "<repo>")
      .replace(/import\("[^"]*\/node_modules\//g, 'import("<dependencies>/');
    const line =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : 0;
    // Missing modules, compiler setup and errors outside test code can never
    // be accepted as test debt (including a missing generated Prisma client).
    const testCode =
      file.startsWith("backend/src/") &&
      (/\.(test|spec)\.ts$/.test(file) || file.includes("/__tests__/"));
    if (!testCode || [2307, 2688, 2792, 6053].includes(diagnostic.code)) {
      fatal.push({ file, line, code: diagnostic.code, message });
      continue;
    }
    const source = diagnostic.file.text
      .slice(diagnostic.start ?? 0, (diagnostic.start ?? 0) + (diagnostic.length ?? 0))
      .replace(/\s+/g, " ")
      .trim();
    const entry = { file, code: diagnostic.code, message, source, count: 1 };
    const key = diagnosticKey(entry);
    const previous = entries.get(key);
    if (previous) previous.count++;
    else entries.set(key, entry);
  }
  const diagnostics = [...entries.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.code - b.code ||
      diagnosticKey(a).localeCompare(diagnosticKey(b))
  );
  return { testFiles: testFiles.length, diagnostics, fatal };
}

function readBaseline(path) {
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  if (baseline.version !== 1 || !Array.isArray(baseline.diagnostics)) {
    throw new Error("Invalid test-types baseline.");
  }
  const seen = new Set();
  for (const entry of baseline.diagnostics) {
    if (
      typeof entry.file !== "string" ||
      !Number.isInteger(entry.code) ||
      typeof entry.message !== "string" ||
      typeof entry.source !== "string" ||
      !Number.isInteger(entry.count) ||
      entry.count < 1 ||
      seen.has(diagnosticKey(entry))
    ) {
      throw new Error("Invalid or duplicate test-types baseline entry.");
    }
    seen.add(diagnosticKey(entry));
  }
  return baseline;
}

export function check({ root = ROOT, baselinePath = BASELINE, update = false } = {}) {
  const baseline = readBaseline(baselinePath); // Missing baseline fails closed.
  const actual = collectTestDiagnostics(root);
  const { added, resolved } = compareDiagnostics(actual.diagnostics, baseline.diagnostics);
  const total = actual.diagnostics.reduce((sum, entry) => sum + entry.count, 0);
  console.log(`${actual.testFiles} backend test files checked; ${total} test type errors found.`);
  if (actual.fatal.length || added.length) {
    for (const entry of [...actual.fatal, ...added].slice(0, 15)) {
      console.error(
        `${entry.file}${entry.line ? `:${entry.line}` : ""} TS${entry.code}: ${entry.message}`
      );
    }
    console.error(
      `FAIL: ${actual.fatal.length} infrastructure/production diagnostic(s), ${added.reduce((n, d) => n + d.count, 0)} new test error(s). Baseline unchanged.`
    );
    return 1;
  }
  if (update) {
    writeFileSync(
      baselinePath,
      JSON.stringify(
        { ...baseline, typescript: ts.version, diagnostics: actual.diagnostics },
        null,
        2
      ) + "\n"
    );
    console.log("Baseline tightened; no new errors accepted.");
  } else if (resolved.length) {
    console.log(
      `Resolved ${resolved.reduce((n, d) => n + d.count, 0)} recorded error(s). Run npm run typecheck:tests -- --update to remove them.`
    );
  }
  console.log("OK: no new backend test type errors.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--update")) {
    console.error("Usage: check-test-types.mjs [--update]");
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = check({ update: flags.includes("--update") });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
