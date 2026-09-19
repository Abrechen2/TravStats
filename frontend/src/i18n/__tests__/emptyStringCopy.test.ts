import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An EMPTY translation value ships the key as copy, exactly as a missing one
 * does — `config.ts` sets `returnEmptyString: false`, so i18next treats ""
 * as absent, tries `fallbackLng: "en"` (empty there too, by the parity rule
 * next door) and hands the caller back `places:stats.wishlistBefore`.
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
 */
const RESOURCES_ROOT = path.resolve(__dirname, "..", "resources");

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

describe("translation resources carry no empty strings", () => {
  it("found locales to check", () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  for (const locale of locales) {
    const dir = path.join(RESOURCES_ROOT, locale);
    it(`"${locale}" has no value that would render as its own key`, () => {
      const empty = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .flatMap((file) => {
          const tree: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
          return leaves(tree)
            .filter(([, value]) => value === "")
            .map(([key]) => `  ${locale}/${file}: ${key}`);
        });
      expect(
        empty,
        `Empty translation values render as the key itself:\n${empty.join("\n")}`
      ).toEqual([]);
    });
  }
});
