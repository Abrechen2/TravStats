import { describe, it, expect } from "vitest";
import { WHATS_NEW_ENTRIES, findEntryForVersion } from "../whatsNew";
import de from "../../i18n/resources/de/whatsNew.json";
import en from "../../i18n/resources/en/whatsNew.json";

function resolve(bundle: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

describe("whatsNew content", () => {
  it("finds an entry by exact version", () => {
    expect(findEntryForVersion("2.4.0")?.version).toBe("2.4.0");
  });

  it("returns undefined for an unknown version", () => {
    expect(findEntryForVersion("9.9.9")).toBeUndefined();
  });

  it("caps highlights at five per entry", () => {
    for (const entry of WHATS_NEW_ENTRIES) {
      expect(entry.highlights.length).toBeGreaterThan(0);
      expect(entry.highlights.length).toBeLessThanOrEqual(5);
    }
  });

  it("resolves every title and body key in BOTH de and en", () => {
    for (const entry of WHATS_NEW_ENTRIES) {
      for (const item of entry.highlights) {
        for (const key of [item.titleKey, item.bodyKey]) {
          expect(resolve(de, key), `missing DE key: ${key}`).toBeTypeOf("string");
          expect(resolve(en, key), `missing EN key: ${key}`).toBeTypeOf("string");
        }
      }
    }
  });
});
