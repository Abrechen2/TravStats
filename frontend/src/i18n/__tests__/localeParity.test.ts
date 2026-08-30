import fs from "fs";
import path from "path";

import { describe, it, expect } from "vitest";

/**
 * Every key exists in BOTH languages, in every namespace.
 *
 * German is the primary locale and English the mirror, but the failure this
 * guards is not "a translation is missing" — it is that a missing translation
 * is INVISIBLE. i18next resolves through `fallbackLng` before it reaches a
 * `defaultValue`, so a key present in one language and absent in the other
 * silently renders the other language's words. Nothing throws, nothing is
 * blank, no test turns red: the page just speaks the wrong language in one
 * spot, which is the kind of thing users stop reporting because it looks
 * deliberate.
 *
 * That is not hypothetical. On 2026-08-30 all 25 new place badges rendered
 * "City stroller" on a German page while "Stadtbummler" sat in the seed the
 * whole time, and a full green suite of 3000+ tests never touched it.
 *
 * Both directions are checked, because both directions are the same bug seen
 * from opposite ends. The list of namespaces is read off the directory rather
 * than written down here, so a namespace added later is covered without anyone
 * remembering to extend this file.
 */
const RESOURCES = path.join(__dirname, "..", "resources");

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key)
  );
}

function keysOf(locale: string, file: string): string[] {
  const raw = fs.readFileSync(path.join(RESOURCES, locale, file), "utf-8");
  return flatten(JSON.parse(raw) as unknown).sort();
}

const namespaces = fs
  .readdirSync(path.join(RESOURCES, "en"))
  .filter((file) => file.endsWith(".json"))
  .sort();

describe("locale parity", () => {
  it("has namespaces to check at all", () => {
    // A path typo would otherwise make every assertion below vacuously pass.
    expect(namespaces.length).toBeGreaterThan(5);
  });

  it("ships the same namespace files in both languages", () => {
    const german = fs
      .readdirSync(path.join(RESOURCES, "de"))
      .filter((file) => file.endsWith(".json"))
      .sort();
    expect(german).toEqual(namespaces);
  });

  describe.each(namespaces)("%s", (file) => {
    it("gives every English key a German one", () => {
      const de = new Set(keysOf("de", file));
      const missing = keysOf("en", file).filter((key) => !de.has(key));
      expect(missing).toEqual([]);
    });

    it("gives every German key an English one", () => {
      const en = new Set(keysOf("en", file));
      const missing = keysOf("de", file).filter((key) => !en.has(key));
      expect(missing).toEqual([]);
    });
  });
});
