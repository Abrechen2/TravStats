import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  check,
  collectTestDiagnostics,
  compareDiagnostics,
  diagnosticKey,
} from "./check-test-types.mjs";

const entry = {
  file: "backend/src/example.test.ts",
  code: 2322,
  message: "wrong type",
  source: "value",
  count: 1,
};

test("counts repeated diagnostics and rejects a new expression with the same error code", () => {
  assert.equal(compareDiagnostics([{ ...entry, count: 2 }], [entry]).added[0].count, 1);
  assert.equal(compareDiagnostics([{ ...entry, source: "otherValue" }], [entry]).added.length, 1);
  assert.equal(compareDiagnostics([], [entry]).resolved[0].count, 1);
  assert.equal(compareDiagnostics([entry], [entry]).added.length, 0);
  assert.equal(diagnosticKey(entry), diagnosticKey({ ...entry, line: 200 }));
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "travstats-type-gate-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "backend/src"), { recursive: true });
  const config = join(root, "backend/tsconfig.tests.json");
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        target: "ES2022",
        module: "CommonJS",
        moduleResolution: "Node",
      },
      include: ["src/**/*.ts"],
    })
  );
  const source = join(root, "backend/src/example.test.ts");
  const baselinePath = join(root, "baseline.json");
  const record = (diagnostics) =>
    writeFileSync(baselinePath, JSON.stringify({ version: 1, diagnostics }));
  return { root, source, config, baselinePath, record };
}

test("checks real TypeScript without executing tests; moving a diagnostic does not create debt", (t) => {
  const { root, source } = fixture(t);
  const text = 'export const value: number = "wrong";\nthrow new Error("must not execute");\n';
  writeFileSync(source, text);
  const first = collectTestDiagnostics(root);
  assert.equal(first.testFiles, 1);
  assert.equal(first.fatal.length, 0);
  assert.equal(first.diagnostics.length, 1);
  writeFileSync(source, "// moved down\n\n" + text);
  assert.deepEqual(collectTestDiagnostics(root).diagnostics, first.diagnostics);
});

test("resolves declared types relative to the backend config, not the caller's directory", (t) => {
  const f = fixture(t);
  const types = join(f.root, "backend/node_modules/@types/fixture");
  mkdirSync(types, { recursive: true });
  writeFileSync(join(types, "index.d.ts"), "declare const typedGlobal: number;");
  const config = JSON.parse(readFileSync(f.config, "utf8"));
  config.compilerOptions.types = ["fixture"];
  writeFileSync(f.config, JSON.stringify(config));
  writeFileSync(f.source, "export const value: number = typedGlobal;");
  const actual = collectTestDiagnostics(f.root);
  assert.deepEqual(actual.fatal, []);
  assert.deepEqual(actual.diagnostics, []);
});

test("an update may remove debt, but must never accept new errors or overwrite the baseline on failure", (t) => {
  const f = fixture(t);
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  writeFileSync(f.source, 'export const value: number = "wrong";');
  f.record(collectTestDiagnostics(f.root).diagnostics);
  assert.equal(check(f), 0);
  const recorded = readFileSync(f.baselinePath, "utf8");
  writeFileSync(f.source, 'export const different: number = "wrong";');
  assert.equal(check({ ...f, update: true }), 1);
  assert.equal(readFileSync(f.baselinePath, "utf8"), recorded);
  writeFileSync(f.source, "export const value: number = 1;");
  assert.equal(check({ ...f, update: true }), 0);
  assert.deepEqual(JSON.parse(readFileSync(f.baselinePath, "utf8")).diagnostics, []);
});

test("production errors and missing modules cannot be recorded as test debt", (t) => {
  const f = fixture(t);
  writeFileSync(
    f.source,
    'import "./production";\nimport { missing } from "./absent";\nexport { missing };'
  );
  writeFileSync(join(f.root, "backend/src/production.ts"), 'export const value: number = "wrong";');
  const actual = collectTestDiagnostics(f.root);
  assert.ok(actual.fatal.some((d) => d.file.endsWith("production.ts")));
  assert.ok(actual.fatal.some((d) => d.code === 2307));
  f.record([]);
  const recorded = readFileSync(f.baselinePath, "utf8");
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  assert.equal(check({ ...f, update: true }), 1);
  assert.equal(readFileSync(f.baselinePath, "utf8"), recorded);
});

test("missing/invalid baselines and a config that selects no tests fail closed", (t) => {
  const f = fixture(t);
  writeFileSync(f.source, "export const value = 1;");
  assert.throws(() => check(f), /ENOENT/);
  f.record([entry, entry]);
  assert.throws(() => check(f), /duplicate/);
  writeFileSync(f.config, JSON.stringify({ include: ["src/production.ts"] }));
  writeFileSync(join(f.root, "backend/src/production.ts"), "export const value = 1;");
  assert.throws(() => collectTestDiagnostics(f.root), /no test files/);
});
