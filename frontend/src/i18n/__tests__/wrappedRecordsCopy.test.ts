import { describe, expect, it } from "vitest";

import deStats from "../resources/de/stats.json";
import enStats from "../resources/en/stats.json";

/**
 * forgejo#53's two standing "do not build" rules, held against the COPY.
 *
 * The rendered-text check in `pages/__tests__/WrappedPage.test.tsx` cannot see
 * these: the suite mocks `t` to echo its key, so a percent sign added to the
 * German sentence would never reach a rendered string. This reads the resource
 * files themselves, which is where such a sentence would actually be written.
 *
 * NO PERCENTAGE OF THE WORLD'S COUNTRIES. There is no agreed count of them, so
 * a percentage puts a made-up denominator under a real numerator. The passport
 * refused the same figure for the same reason; the year in review sits next to
 * it and must not reintroduce it by the back door.
 *
 * NO FLAGS AS AN IDENTIFIER. The ISO code is the glyph. Flags are political,
 * go out of date, and render differently on every platform.
 */

const BLOCKS = [
  ["de stats:records", deStats.records],
  ["de stats:wrapped", deStats.wrapped],
  ["en stats:records", enStats.records],
  ["en stats:wrapped", enStats.wrapped],
] as const;

describe("Rekorde and Dein Jahr copy", () => {
  for (const [name, block] of BLOCKS) {
    it(`${name} states no percentage and shows no flag`, () => {
      const copy = JSON.stringify(block);
      expect(copy).not.toContain("%");
      expect(copy).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    });
  }

  it("names all seven records on both sides", () => {
    const ids = [
      "longest-flight",
      "shortest-flight",
      "busiest-day",
      "longest-aloft",
      "biggest-delay",
      "northernmost",
      "longest-streak",
    ];
    // A missing name is silent: react-i18next renders the key itself, so the
    // card would headline "stats:records.names.northernmost".
    for (const id of ids) {
      expect(Object.keys(deStats.records.names)).toContain(id);
      expect(Object.keys(enStats.records.names)).toContain(id);
    }
  });
});
