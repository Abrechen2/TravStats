import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — the generator is a plain .mjs build script, not typed source.
import { buildThemeCss, OUTPUT_PATH, TOKENS_PATH } from "../../../scripts/generate-theme.mjs";

/**
 * The first of the four guards in DESIGN_SYSTEM.md §10.
 *
 * `tokens.css` is a build artefact of `design/tokens.json`, and the whole
 * system rests on that being true: the moment somebody nudges a colour in the
 * CSS instead of the JSON, the web and the Companion have quietly forked and
 * nothing says so. Comparing the checked-in file to a fresh generation is what
 * turns "please regenerate" from a convention into a failing test.
 */
describe("theme token generation", () => {
  it("the checked-in tokens.css is exactly what the generator produces", () => {
    const onDisk = readFileSync(OUTPUT_PATH, "utf8");
    expect(onDisk).toBe(buildThemeCss());
  });

  it("carries every colour in the token file, so nothing silently drops out", () => {
    const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
    const css = readFileSync(OUTPUT_PATH, "utf8");
    for (const [key, value] of Object.entries(tokens.color)) {
      if (key.startsWith("_")) continue;
      expect(css, `color.${key} is missing from tokens.css`).toContain(value as string);
    }
    for (const [key, value] of Object.entries(tokens.domainColor)) {
      if (key.startsWith("_")) continue;
      expect(css, `domainColor.${key} is missing from tokens.css`).toContain(value as string);
    }
  });

  it("gives every role in typography.scale a utility class", () => {
    const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
    const css = readFileSync(OUTPUT_PATH, "utf8");
    const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    for (const role of Object.keys(tokens.typography.scale)) {
      expect(css, `no .t-${kebab(role)} utility`).toContain(`@utility t-${kebab(role)} {`);
    }
  });

  it("introduces no colour of its own beyond the four web derivations", () => {
    // Every hex in the generated file must also appear in the token file. The
    // four web-only values (§2.1) are rgba re-alphas of `border` and `canvas`,
    // so they carry no hex at all — which is the point: a desktop needs hover,
    // focus and a scrim, and it gets them without a fifth grey.
    const css = readFileSync(OUTPUT_PATH, "utf8");
    const json = readFileSync(TOKENS_PATH, "utf8").toLowerCase();
    const hexes = new Set((css.toLowerCase().match(/#[0-9a-f]{3,8}\b/g) ?? []) as string[]);
    for (const hex of hexes) {
      expect(json, `${hex} is in tokens.css but not in tokens.json`).toContain(hex);
    }
  });
});
