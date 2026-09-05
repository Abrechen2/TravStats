import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAINS } from "../shared/domains";

/**
 * The domain accent variables in `index.css`.
 *
 * Two guards, one old and one new.
 *
 * The old one: `--domain-hotel*` was the pre-brand-rename name for lodging.
 * Every consumer already read `--domain-lodging`, so the old name reappearing
 * would be silent — nothing renders, and a missing custom property renders as
 * nothing rather than as an error.
 *
 * The new one, since 2.7.0: these variables no longer carry hexes. They read
 * the generated token layer, so `--domain-cruise` and `--ts-domain-cruise`
 * cannot disagree. Before that they were two copies of one decision — and the
 * copies had already drifted, which is exactly what the domain colour swap of
 * this release had to repair.
 */
const CSS_PATH = path.resolve(__dirname, "..", "index.css");
const TOKENS_PATH = path.resolve(__dirname, "..", "theme", "tokens.css");

describe("index.css domain accent variables", () => {
  it("no longer defines --domain-hotel*", () => {
    const content = fs.readFileSync(CSS_PATH, "utf-8");
    expect(content).not.toMatch(/--domain-hotel/);
  });

  it("carries no hex of its own — every domain accent reads a token", () => {
    const content = fs.readFileSync(CSS_PATH, "utf-8");
    const definitions = content.match(/--domain-[\w-]+:\s*[^;]+;/g) ?? [];
    expect(definitions.length).toBeGreaterThan(10);
    for (const definition of definitions) {
      expect(definition, `${definition} should read a token, not paint`).not.toMatch(
        /#[0-9a-f]{3,8}/i
      );
    }
  });

  it("maps each domain onto the token the Companion agreed to", () => {
    const content = fs.readFileSync(CSS_PATH, "utf-8");
    expect(content).toMatch(/--domain-flight:\s*var\(--ts-domain-flight\);/);
    expect(content).toMatch(/--domain-cruise:\s*var\(--ts-domain-cruise\);/);
    // The lodging domain is `hotel` in the token file — the Companion's name.
    expect(content).toMatch(/--domain-lodging:\s*var\(--ts-domain-hotel\);/);
    expect(content).toMatch(/--domain-poi:\s*var\(--ts-domain-poi\);/);
  });

  it("gives tours ONE colour, with the five old names as aliases of it", () => {
    // Owner decision of 2026-09-05: tours are one domain with one colour and
    // the means of transport only changes the icon. The aliases exist so a
    // layer that still says `--domain-bike` renders in the tour colour rather
    // than in nothing while block 4 moves them over.
    const content = fs.readFileSync(CSS_PATH, "utf-8");
    expect(content).toMatch(/--domain-tour:\s*var\(--ts-domain-tour\);/);
    for (const legacy of ["train", "hike", "bike", "road", "ferry"]) {
      expect(content, `--domain-${legacy} should alias the tour colour`).toMatch(
        new RegExp(`--domain-${legacy}:\\s*var\\(--domain-tour\\);`)
      );
    }
  });

  it("agrees with the domain registry, which agrees with the token file", () => {
    const tokens = fs.readFileSync(TOKENS_PATH, "utf-8");
    const expected: [string, string][] = [
      ["flight", DOMAINS.flight.color],
      ["cruise", DOMAINS.cruise.color],
      ["hotel", DOMAINS.lodging.color],
      ["poi", DOMAINS.poi.color],
    ];
    for (const [tokenName, value] of expected) {
      expect(tokens, `--ts-domain-${tokenName} should be ${value}`).toMatch(
        new RegExp(`--ts-domain-${tokenName}:\\s*${value};`)
      );
    }
  });
});
