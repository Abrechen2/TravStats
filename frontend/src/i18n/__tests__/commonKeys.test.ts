import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import de from "../resources/de/common.json";
import en from "../resources/en/common.json";

/**
 * Guard against a regression class where `common.json` defines a key as a
 * nested object (e.g. `loading: { default: "...", title: "..." }`) but code
 * calls `t("common:loading")` directly. i18next's `t()` never returns an
 * object for a plain call like that — it either falls back to the raw key
 * or logs "returned an object instead of string", so the literal text leaks
 * into the UI. TypeScript can't catch this (the key exists on the resource
 * type) and neither can a normal render test unless it happens to assert on
 * that exact loading state, so we scan the source for every literal
 * `t("common:...")` call and verify each resolved key is a string in BOTH
 * locales.
 *
 * Only *literal* string-quoted keys are checked — `t(`common:${x}`)` calls
 * are dynamic and can't be verified statically, so they are intentionally
 * skipped.
 */

const SRC_ROOT = path.resolve(__dirname, "..", "..");

// Matches t("common:some.dotted.key") / t('common:some.dotted.key').
// Deliberately does NOT match backtick template literals (dynamic keys).
const COMMON_KEY_CALL = /\bt\(\s*(["'])(common:[A-Za-z0-9_.]+)\1/g;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Maps a dotted key (e.g. "loading.default") to the list of files that use it. */
function findCommonKeyUsages(): Map<string, string[]> {
  const usages = new Map<string, string[]>();
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const content = fs.readFileSync(file, "utf-8");
    const relFile = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
    for (const match of content.matchAll(COMMON_KEY_CALL)) {
      const fullKey = match[2]; // e.g. "common:loading"
      const dottedKey = fullKey.slice("common:".length);
      const existing = usages.get(dottedKey);
      if (existing) {
        if (!existing.includes(relFile)) existing.push(relFile);
      } else {
        usages.set(dottedKey, [relFile]);
      }
    }
  }
  return usages;
}

function resolveDottedPath(resource: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, segment) => {
    if (acc !== null && typeof acc === "object" && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, resource);
}

describe("every literal t(\"common:...\") call resolves to a string", () => {
  const usages = findCommonKeyUsages();

  it("scanner found usages (sanity check the scan itself isn't broken)", () => {
    expect(usages.size).toBeGreaterThan(0);
  });

  for (const [dottedKey, files] of usages) {
    it(`common:${dottedKey} (used in ${files.join(", ")})`, () => {
      const deValue = resolveDottedPath(de, dottedKey);
      const enValue = resolveDottedPath(en, dottedKey);

      expect(
        typeof deValue === "string",
        `common:${dottedKey} does not resolve to a string in de/common.json ` +
          `(got ${JSON.stringify(deValue)}). Used in: ${files.join(", ")}`
      ).toBe(true);

      expect(
        typeof enValue === "string",
        `common:${dottedKey} does not resolve to a string in en/common.json ` +
          `(got ${JSON.stringify(enValue)}). Used in: ${files.join(", ")}`
      ).toBe(true);
    });
  }
});
