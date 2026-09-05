import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BETA_FEATURES,
  BETA_FEATURE_KEYS,
  isBetaFeatureKey,
  type BetaFeatureKey,
} from "../../config/betaFeatures";

const SRC = resolve(__dirname, "../..");

/** Every .ts/.tsx file under src/, excluding the registry and the tests. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

/**
 * Collect every key passed to `isFeatureVisible("…")` or
 * `useBetaFeatureAccess("…")` anywhere in the app.
 * Deliberately a source scan rather than a type-level assertion: the point is
 * to catch a gate whose key was never registered — and the registry is the
 * only record of WHY each feature is hidden and WHEN it comes back. Without
 * this, six months from now there are a dozen anonymous `if (betaEnabled)`
 * checks and nothing ever gets un-gated.
 *
 * Three spellings, because a source-scanning guard ages: the three-state
 * `useBetaFeatureAccess` form arrived after this scan was written, and until
 * 2026-09-05 a route gated only that way (the passport, `poiDomain` via
 * usePlacesAccess) was invisible to the "nothing gates it" check below. The
 * `gatedSections` table arrived with the settings routes in 2.7.0 and is the
 * same story: the settings page now resolves its gate from a variable, so a
 * scan that only knows call sites would have declared `devicePairing`
 * ungated on the day it moved into a table.
 */
function gateKeysInSource(): { key: string; file: string }[] {
  const found: { key: string; file: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    if (file.endsWith(join("config", "betaFeatures.ts"))) continue;
    const contents = readFileSync(file, "utf8");
    const matches = contents.matchAll(
      /(?:isFeatureVisible|useBetaFeatureAccess)\(\s*["'`]([^"'`]+)["'`]\s*\)/g
    );
    for (const match of matches) {
      found.push({ key: match[1], file });
    }
    // A gate declared as data: `gatedSections: { devices: "devicePairing" }`.
    for (const table of contents.matchAll(/gatedSections:\s*\{([^}]*)\}/g)) {
      for (const entry of table[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
        found.push({ key: entry[1], file });
      }
    }
  }
  return found;
}

describe("beta feature registry", () => {
  it("registers a reason, a rationale and an un-gating condition for every key", () => {
    expect(BETA_FEATURE_KEYS.length).toBeGreaterThan(0);
    for (const key of BETA_FEATURE_KEYS) {
      const meta = BETA_FEATURES[key];
      expect(["beta", "advanced"]).toContain(meta.reason);
      expect(meta.why.length).toBeGreaterThan(10);
      expect(meta.returnsWhen.length).toBeGreaterThan(5);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(BETA_FEATURES)).toBe(true);
  });

  it("every key used in a gate exists in the registry", () => {
    const used = gateKeysInSource();

    // Guard the guard: if the scan finds nothing, the regex has drifted away
    // from how gates are actually written and this test silently passes.
    expect(used.length).toBeGreaterThan(0);

    const unregistered = used.filter(({ key }) => !isBetaFeatureKey(key));
    expect(
      unregistered.map(({ key, file }) => `${key} (${file})`),
      "gate keys missing from config/betaFeatures.ts"
    ).toEqual([]);
  });

  it("gates every currently hidden feature", () => {
    const used = new Set(gateKeysInSource().map(({ key }) => key));
    // Every registered key, not a sample: an entry nothing gates is a reason
    // without a feature, and the registry exists to keep the two together.
    const expected: readonly BetaFeatureKey[] = BETA_FEATURE_KEYS;
    for (const key of expected) {
      expect(used.has(key), `${key} is registered but nothing gates it`).toBe(true);
    }
  });

  it("rejects unknown keys", () => {
    expect(isBetaFeatureKey("nope")).toBe(false);
    expect(isBetaFeatureKey(undefined)).toBe(false);
  });
});
