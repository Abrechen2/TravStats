import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every entry in the settings navigation must take its label from a
 * translation key.
 *
 * "About" was a bare English literal among a dozen translated siblings, so a
 * German settings page carried one English word (#321). The DE/EN parity guard
 * cannot see this class of bug: there was no key to be missing, only a string
 * that never asked for one.
 *
 * This scans the source rather than rendering the page, because the page tests
 * mock `t` to return the key — a rendered label would look like a key whether
 * or not it went through translation. A source scan ages, so the first
 * assertion checks the scan still finds the section list at all; without it
 * this file would pass forever the day the array is renamed or moved.
 */

const SOURCE = resolve(__dirname, "../../pages/SettingsPage.tsx");

describe("settings navigation labels", () => {
  const source = readFileSync(SOURCE, "utf8");
  const labels = [...source.matchAll(/\{\s*id:\s*"[a-zA-Z]+",\s*label:\s*([^\n]+?),?\s*\}/g)].map(
    (m) => m[1].trim()
  );

  it("still finds the section list — the scan has not aged out", () => {
    expect(labels.length).toBeGreaterThan(5);
  });

  it("takes every label from a translation key, never a bare literal", () => {
    const literals = labels.filter((l) => /^"[^"]*"$/.test(l));
    expect(literals).toEqual([]);
  });
});
