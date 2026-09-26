import { readFileSync } from "fs";
import path from "path";

import { achievements } from "../achievements";

/**
 * Every badge in the catalogue has German AND English copy in the frontend.
 *
 * The page prefers `codes.<CODE>` from `achievements.json` and falls back to
 * the seed's German name without an error — so a badge added here and never
 * given copy ships German in an English UI, and nobody reports a page that
 * still looks like it works. `frontend/src/i18n/__tests__/achievementCodeMirrors.test.ts`
 * can only check the codes it lists by hand; this side owns the catalogue and
 * can check all of them.
 */

const RESOURCES = path.resolve(__dirname, "../../../../frontend/src/i18n/resources");

type Copy = Record<string, { name?: string; description?: string }>;

function codesOf(lang: "de" | "en"): Copy {
  const file = path.join(RESOURCES, lang, "achievements.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { codes: Copy }).codes;
}

describe("achievement copy", () => {
  it.each(["de", "en"] as const)("gives every seeded badge a %s name and description", (lang) => {
    const codes = codesOf(lang);
    const missing = achievements
      .map((a) => a.code)
      .filter((code) => !codes[code]?.name || !codes[code]?.description);
    expect(missing).toEqual([]);
  });
});
