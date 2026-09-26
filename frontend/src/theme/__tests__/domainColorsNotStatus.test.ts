import { describe, expect, it } from "vitest";

import { tokens } from "../tokens";
import { hexToRgb } from "../../lib/domainColor";
import { DOMAINS, TOUR_COLOR, type DomainKey } from "../../shared/domains";

/**
 * A domain colour is never a demanding status colour (round 29, owner
 * 2026-09-26, forgejo#131): info, warn, bad — and accent, except for the flight,
 * whose amber the accent was taken from.
 *
 * Why it needs a guard: rail used to be brick red #d4655c beside `bad`
 * #e65a4f. A rail row next to a cancelled flight read the same, and a late
 * train had no colour left to say "late". Nothing failed while that shipped.
 *
 * Every value is read from the generated token layer (which
 * `tokens.generated.test.ts` ties to `design/tokens.json`) and from the domain
 * registry — no hex is restated here, so the test follows the next palette
 * change instead of pinning this one.
 */

const DEMANDING = ["info", "warn", "bad"] as const;

/** Registry domain → its name in the token file (the Companion calls lodging "hotel"). */
const TOKEN_NAME: Record<DomainKey, keyof typeof tokens.domainColor> = {
  flight: "flight",
  cruise: "cruise",
  lodging: "hotel",
  poi: "poi",
  roadtrip: "roadtrip",
  rail: "rail",
};

function tokenDomainColors(): [string, string][] {
  return Object.entries(tokens.domainColor).filter(([name]) => !name.startsWith("_"));
}

const lower = (hex: string): string => hex.toLowerCase();

/**
 * "Equals" alone would not have caught the defect this file exists for: brick
 * red #d4655c was never byte-equal to `bad` #e65a4f, it was 24.8 apart in RGB.
 * So a domain must also keep its distance. Measured on the round-29 palette,
 * the closest domain/status pair is cruise vs info at 53.4; 40 sits between
 * the defect and the nearest legitimate pair. The flight is exempt, as it is
 * from the accent rule: `warn` #d8952f is the accent's own pressed shade, 39.4
 * from the flight amber the accent was taken from.
 */
const MIN_RGB_DISTANCE = 40;

function rgbDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

describe("domain colours stay clear of the status colours", () => {
  it("no domain default in the token file equals info, warn or bad", () => {
    for (const [name, hex] of tokenDomainColors()) {
      for (const status of DEMANDING) {
        expect(lower(hex), `domainColor.${name} equals color.${status}`).not.toBe(
          lower(tokens.color[status])
        );
      }
    }
  });

  it("no domain default sits near info, warn or bad either", () => {
    for (const [name, hex] of tokenDomainColors()) {
      if (name === "flight") continue;
      for (const status of DEMANDING) {
        const distance = rgbDistance(hex, tokens.color[status]);
        expect(
          distance,
          `domainColor.${name} is ${distance.toFixed(1)} from color.${status}`
        ).toBeGreaterThanOrEqual(MIN_RGB_DISTANCE);
      }
    }
  });

  it("only the flight may share the accent", () => {
    for (const [name, hex] of tokenDomainColors()) {
      if (name === "flight") continue;
      expect(lower(hex), `domainColor.${name} equals color.accent`).not.toBe(
        lower(tokens.color.accent)
      );
    }
  });

  it("the registry defaults are the token values, so the rule above covers them", () => {
    for (const key of Object.keys(TOKEN_NAME) as DomainKey[]) {
      expect(lower(DOMAINS[key].color), `DOMAINS.${key}.color`).toBe(
        lower(tokens.domainColor[TOKEN_NAME[key]])
      );
    }
    expect(lower(TOUR_COLOR)).toBe(lower(tokens.domainColor.tour));
  });

  it("roadtrip and tour are one colour — the Companion's single road hue", () => {
    expect(lower(tokens.domainColor.roadtrip)).toBe(lower(tokens.domainColor.tour));
  });
});
