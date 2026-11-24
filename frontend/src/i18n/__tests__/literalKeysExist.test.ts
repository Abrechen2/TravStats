import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DOMAIN_KEYS } from "../../shared/domains";

/**
 * A key the code names that no resource holds renders as the key itself:
 * UAT rc.45 found `legend.unvisitedListMember` on the map legend (the copy sat
 * under `poi.legend`) and `controls.addPerTab.ferry` on three dashboard tabs.
 * `localeKeyParity` cannot see that — both locales agreed, they just did not
 * hold the key the code asked for.
 *
 * This scans every non-test source file for a LITERAL `t("namespace:key")`
 * and checks the key exists in the German resources (EN parity is the other
 * suite's job). Dynamic keys cannot be read statically; the one dashboard
 * family built from a domain is checked for every domain below.
 */

const SRC = path.resolve(__dirname, "..", "..");
const DE_DIR = path.resolve(__dirname, "..", "resources", "de");

const namespaces = new Map<string, unknown>(
  fs
    .readdirSync(DE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [
      f.replace(/\.json$/, ""),
      JSON.parse(fs.readFileSync(path.join(DE_DIR, f), "utf8")),
    ])
);

/** Whether `key` resolves in `tree`, counting i18next's plural suffixes and array indices. */
function resolves(tree: unknown, key: string): boolean {
  let node: unknown = tree;
  const parts = key.split(".");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (node !== null && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
      continue;
    }
    const last = i === parts.length - 1;
    return (
      last &&
      node !== null &&
      typeof node === "object" &&
      Object.keys(node as object).some((k) => k.startsWith(`${part}_`))
    );
  }
  return true;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "i18n" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

const LITERAL = /\bt\(\s*["']([a-zA-Z]+):([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)["']/g;

describe("every literal translation key the code names exists (UAT rc.45 M3/M4)", () => {
  it('resolves each t("ns:key") in the German resources', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = fs.readFileSync(file, "utf8");
      for (const [, ns, key] of source.matchAll(LITERAL)) {
        if (!namespaces.has(ns)) continue;
        if (!resolves(namespaces.get(ns), key)) {
          missing.push(`${path.relative(SRC, file)}: ${ns}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has an add label for every domain a dashboard tab can show", () => {
    const missing = DOMAIN_KEYS.filter(
      (domain) => !resolves(namespaces.get("dashboard"), `controls.addPerTab.${domain}`)
    );
    expect(missing).toEqual([]);
  });
});
