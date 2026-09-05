import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, it, expect } from "vitest";
import { WHATS_NEW_ENTRIES, compareVersions, findEntryForVersion } from "../whatsNew";
import de from "../../i18n/resources/de/whatsNew.json";
import en from "../../i18n/resources/en/whatsNew.json";

function resolve(bundle: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

// vitest runs with cwd = frontend/, so backend/VERSION is one level up.
const SHIPPING_VERSION = readFileSync(
  resolvePath(process.cwd(), "..", "backend", "VERSION"),
  "utf8"
).trim();

describe("whatsNew content", () => {
  /**
   * The regression that shipped in 2.3.0: the only entry was keyed "2.4.0"
   * because the feature was *planned* for 2.4.0, then shipped in 2.3.0. The
   * modal could never fire — and neither could the usage-stats consent card,
   * which renders inside it. The old tests missed it because they asserted the
   * same wrong constant back at themselves.
   *
   * An entry pointing at an unreleased version is always a bug: nobody is
   * running that version yet, so it is dead content.
   */
  it("has no entry targeting a version newer than backend/VERSION", () => {
    for (const entry of WHATS_NEW_ENTRIES) {
      expect(
        compareVersions(entry.version, SHIPPING_VERSION),
        `entry "${entry.version}" targets a version newer than the shipping ${SHIPPING_VERSION} — it can never be shown`
      ).toBeLessThanOrEqual(0);
    }
  });

  it("matches an entry on the exact version it targets", () => {
    expect(findEntryForVersion("2.3.0")?.version).toBe("2.3.0");
  });

  it("still matches on a later patch than the entry targets", () => {
    // 2.3.7 sits between the 2.3.0 and 2.4.0 entries — the older one applies.
    expect(findEntryForVersion("2.3.7")?.version).toBe("2.3.0");
  });

  it("does not match an entry from the future", () => {
    expect(findEntryForVersion("2.2.2")).toBeUndefined();
  });

  it("picks the newest non-future entry when several qualify", () => {
    const sorted = [...WHATS_NEW_ENTRIES].sort((a, b) => compareVersions(b.version, a.version));
    expect(findEntryForVersion("999.0.0")?.version).toBe(sorted[0].version);
  });

  it("compares versions numerically, not lexically", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.3.0", "2.3.0-rc.5")).toBe(0);
    expect(compareVersions("2.3.0", "2.3.1")).toBeLessThan(0);
  });

  // Eight since 2.6.0 — see the comment on `WhatsNewEntry.highlights`.
  it("caps highlights at eight per entry", () => {
    for (const entry of WHATS_NEW_ENTRIES) {
      expect(entry.highlights.length).toBeGreaterThan(0);
      expect(entry.highlights.length).toBeLessThanOrEqual(8);
    }
  });

  // Owner, 2026-09-05: tours, the Companion pairing and Dawarich are beta —
  // back behind the switch in 2.6.1, so they are listed in the beta item.
  it("marks the 2.6.0 beta items and nothing else in that entry", () => {
    const entry = findEntryForVersion("2.6.0");
    expect(entry?.highlights.filter((h) => h.beta).map((h) => h.titleKey)).toEqual([
      "entries.v260.beta.title",
    ]);
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
