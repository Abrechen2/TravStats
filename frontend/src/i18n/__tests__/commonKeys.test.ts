import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import deCommon from "../resources/de/common.json";
import enCommon from "../resources/en/common.json";
import deLodging from "../resources/de/lodging.json";
import enLodging from "../resources/en/lodging.json";
import deLocation from "../resources/de/location.json";
import enLocation from "../resources/en/location.json";

/**
 * Guard against a regression class where a namespace's resource file defines
 * a key as a nested object (e.g. `loading: { default: "...", title: "..." }`)
 * but code calls `t("common:loading")` directly. i18next's `t()` never
 * returns an object for a plain call like that — it either falls back to the
 * raw key or logs "returned an object instead of string", so the literal
 * text leaks into the UI. TypeScript can't catch this (the key exists on the
 * resource type) and neither can a normal render test unless it happens to
 * assert on that exact state, so we scan the source for every literal
 * `t("<namespace>:...")` call and verify each resolved key is a string in
 * BOTH locales.
 *
 * Only *literal* string-quoted keys are checked — `t(`lodging:${x}`)` calls
 * are dynamic and can't be verified statically, so they are intentionally
 * skipped (dynamic lodging keys — `type.${type}`, `board.${board}`,
 * `stayStatus.${status}` — are covered instead by enumerating their unions
 * against both resource files below).
 */

const SRC_ROOT = path.resolve(__dirname, "..", "..");

const NAMESPACES: Record<string, { de: unknown; en: unknown }> = {
  common: { de: deCommon, en: enCommon },
  lodging: { de: deLodging, en: enLodging },
  location: { de: deLocation, en: enLocation },
};

function buildKeyCallRegex(namespace: string): RegExp {
  // Matches t("<namespace>:some.dotted.key") / t('<namespace>:some.dotted.key').
  // Deliberately does NOT match backtick template literals (dynamic keys).
  return new RegExp(`\\bt\\(\\s*(["'])(${namespace}:[A-Za-z0-9_.]+)\\1`, "g");
}

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
function findNamespaceKeyUsages(namespace: string): Map<string, string[]> {
  const usages = new Map<string, string[]>();
  const keyCallRegex = buildKeyCallRegex(namespace);
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const content = fs.readFileSync(file, "utf-8");
    const relFile = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
    for (const match of content.matchAll(keyCallRegex)) {
      const fullKey = match[2]; // e.g. "common:loading"
      const dottedKey = fullKey.slice(namespace.length + 1);
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

for (const [namespace, { de, en }] of Object.entries(NAMESPACES)) {
  describe(`every literal t("${namespace}:...") call resolves to a string`, () => {
    const usages = findNamespaceKeyUsages(namespace);

    it("scanner found usages (sanity check the scan itself isn't broken)", () => {
      expect(usages.size).toBeGreaterThan(0);
    });

    for (const [dottedKey, files] of usages) {
      it(`${namespace}:${dottedKey} (used in ${files.join(", ")})`, () => {
        const deValue = resolveDottedPath(de, dottedKey);
        const enValue = resolveDottedPath(en, dottedKey);

        expect(
          typeof deValue === "string",
          `${namespace}:${dottedKey} does not resolve to a string in de/${namespace}.json ` +
            `(got ${JSON.stringify(deValue)}). Used in: ${files.join(", ")}`
        ).toBe(true);

        expect(
          typeof enValue === "string",
          `${namespace}:${dottedKey} does not resolve to a string in en/${namespace}.json ` +
            `(got ${JSON.stringify(enValue)}). Used in: ${files.join(", ")}`
        ).toBe(true);
      });
    }
  });
}

/**
 * Dynamic lodging keys built via template literals (`t(\`lodging:type.${type}\`)`
 * etc.) are invisible to the literal-call scanner above, so their unions are
 * enumerated here explicitly and checked the same way.
 */
describe("every dynamic lodging:* union member resolves to a string", () => {
  const dynamicUnions: Record<string, readonly string[]> = {
    type: ["hotel", "campsite", "guesthouse", "apartment", "hostel"],
    board: ["none", "breakfast", "half", "full", "all_inclusive"],
    stayStatus: ["scheduled", "completed", "cancelled"],
  };

  for (const [prefix, members] of Object.entries(dynamicUnions)) {
    for (const member of members) {
      const dottedKey = `${prefix}.${member}`;
      it(`lodging:${dottedKey}`, () => {
        const deValue = resolveDottedPath(deLodging, dottedKey);
        const enValue = resolveDottedPath(enLodging, dottedKey);

        expect(typeof deValue === "string", `lodging:${dottedKey} missing/non-string in de`).toBe(
          true
        );
        expect(typeof enValue === "string", `lodging:${dottedKey} missing/non-string in en`).toBe(
          true
        );
      });
    }
  }
});
