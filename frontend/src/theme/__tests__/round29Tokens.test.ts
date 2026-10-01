import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKENS_PATH } from "../../../scripts/generate-theme.mjs";

/**
 * Round 29 (Claude Design, 2026-09-26; owner: the web follows, forgejo#131).
 *
 * The domain hues landed first (c347e8c8f) and the token file said so in its
 * own `_note29`: "the other round-29 tokens are still outstanding". This file
 * guards the rest of the mirror — the parts of round 29 that are statements
 * about the domain colours rather than the colours themselves.
 *
 * Every assertion reads `design/tokens.json`; no hex is restated, so the test
 * follows the next palette change instead of pinning this one.
 */
interface TokenFile {
  version: string;
  domainColor: Record<string, string>;
  listColor: { _excluded: string[] };
  consoleRank: string[];
  activityColor?: unknown;
  mapLine?: Record<string, string>;
}

const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as TokenFile;

const domainHexes = (): [string, string][] =>
  Object.entries(tokens.domainColor).filter(([name]) => !name.startsWith("_"));

/** `"road 1.5"` → 1.5 — the stroke width is the one number in a mapLine entry. */
const strokeOf = (line: string): number => Number(line.match(/(\d+(?:\.\d+)?)/)?.[1]);

describe("round-29 tokens are mirrored from the Companion", () => {
  it("names the round in its version", () => {
    expect(tokens.version).toBe("0.8.0-runde29");
  });

  it("keeps every domain colour out of the user list palette", () => {
    // A place list painted in a domain hue reads as that domain on the map.
    // Round 29 added rail and road to the exclusions; without them the file
    // claims an exclusion list that no longer matches its own domains.
    const excluded = tokens.listColor._excluded.map((entry) => entry.split(" ")[0].toLowerCase());
    for (const [name, hex] of domainHexes()) {
      if (name === "poi") continue; // the text ink, not a hue — never a list colour candidate
      if (name === "flight") continue; // excluded as `accent`, the same value
      expect(excluded, `domainColor.${name} ${hex} is not excluded`).toContain(hex.toLowerCase());
    }
  });

  it("ranks the rail console right after the flight", () => {
    expect(tokens.consoleRank.slice(0, 2)).toEqual(["flight", "rail"]);
  });

  it("gives activities an icon, never a colour", () => {
    expect(tokens.activityColor).toBeNull();
  });

  it("draws a tour and a road leg in one colour, the tour thinner", () => {
    const { tour, roadLeg } = tokens.mapLine ?? {};
    expect(tour?.split(" ")[0]).toBe(roadLeg?.split(" ")[0]);
    expect(strokeOf(tour ?? "")).toBeLessThan(strokeOf(roadLeg ?? ""));
  });
});
