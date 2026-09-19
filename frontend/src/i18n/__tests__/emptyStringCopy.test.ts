import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A translation value that is EMPTY ships the key as copy, exactly as a
 * missing one does. `config.ts` sets `returnEmptyString: false`, so i18next
 * treats `""` as absent, tries `fallbackLng: "en"` (empty there too, by the
 * parity rule next door) and hands the caller back
 * `places:stats.wishlistBefore`.
 *
 * It is the harder of the two to catch, because it survives
 * `localeKeyParity`: the key IS present on both sides. It also survives every
 * render test in this tree, since they all stub `t` with `(k) => k` and
 * therefore assert the very string the defect produces.
 *
 * Measured on 2026-09-19, while splitting a sentence around an inline
 * evidence trigger: three "…Before" keys were added as "" for sentences whose
 * number comes first, and all three would have rendered their own key in
 * front of the figure. The fix is not an empty value — it is no key at all.
 *
 * Two more values are rejected here, and they are NOT the same defect:
 *
 *  - `null` is the same defect by a different door. `config.ts` sets
 *    `returnNull: false` on the line below `returnEmptyString`, so a null
 *    value falls through to the fallback and then to the key, identically.
 *    JSON allows it where TypeScript would not, because the resources are
 *    plain data nothing type-checks.
 *  - A WHITESPACE-ONLY value renders as written — a space, not the key. It is
 *    included because it is the same MISTAKE (a placeholder standing in for
 *    "this key should not exist") wearing a disguise that no longer trips the
 *    empty check, and because invisible copy is unreviewable: nobody spots
 *    " " in a diff, and DE/EN parity is happy with it on both sides.
 */
const RESOURCES_ROOT = path.resolve(__dirname, "..", "resources");

/**
 * Exported so the case below can exercise the RULE against a fixture rather
 * than restate it. A guard that scans real files has no failing example of
 * its own, so a predicate quietly narrowed to nothing would keep passing.
 */
export function rendersAsItsOwnKeyOrBlank(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "string" && value.trim() === "";
}

function leaves(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (typeof value !== "object" || value === null) return [[prefix, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key)
  );
}

const locales = fs
  .readdirSync(RESOURCES_ROOT)
  .filter((name) => fs.statSync(path.join(RESOURCES_ROOT, name)).isDirectory())
  .sort();

describe("translation resources carry no blank values", () => {
  it("found locales to check", () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  it("rejects the three shapes, and nothing else", () => {
    const fixture = {
      empty: "",
      nulled: null,
      spaces: "   ",
      tab: "\t",
      real: "Prämiennächte",
      leadingSpace: "in ",
      zero: "0",
    };
    const caught = leaves(fixture)
      .filter(([, value]) => rendersAsItsOwnKeyOrBlank(value))
      .map(([key]) => key)
      .sort();
    expect(caught).toEqual(["empty", "nulled", "spaces", "tab"]);
    // `"in "` is the interpolation prefix this guard was written beside, and
    // `"0"` is a legitimate figure — narrowing to `!value` would take both.
  });

  for (const locale of locales) {
    const dir = path.join(RESOURCES_ROOT, locale);
    it(`"${locale}" has no value that would render as its own key, or as nothing`, () => {
      const blank = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .flatMap((file) => {
          const tree: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
          return leaves(tree)
            .filter(([, value]) => rendersAsItsOwnKeyOrBlank(value))
            .map(([key]) => `  ${locale}/${file}: ${key}`);
        });
      expect(
        blank,
        `Blank translation values render as the key itself, or as nothing:\n${blank.join("\n")}`
      ).toEqual([]);
    });
  }
});
