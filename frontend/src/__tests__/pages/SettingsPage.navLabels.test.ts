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

// The section list left SettingsPage.tsx on the design-system branch: one
// route per group, and every label a key in `SECTION_LABEL_KEY`.
const SOURCE = resolve(__dirname, "../../pages/Settings/sectionLabels.ts");

describe("settings navigation labels", () => {
  const source = readFileSync(SOURCE, "utf8");
  const block = source.slice(source.indexOf("SECTION_LABEL_KEY"));
  const labels = [...block.matchAll(/^\s+[a-zA-Z]+:\s*([^\n]+?),\s*$/gm)].map((m) => m[1].trim());

  it("still finds the section list — the scan has not aged out", () => {
    expect(labels.length).toBeGreaterThan(5);
  });

  it("takes every label from a translation key, never a bare literal", () => {
    // A key names its namespace: "settings:about.title". Anything else is
    // copy that never went through translation.
    const literals = labels.filter((l) => !/^"[a-z]+:[A-Za-z0-9_.]+"$/.test(l));
    expect(literals).toEqual([]);
  });
});
