import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "@jest/globals";
import {
  DOMAIN_KEYS,
  DOMAINS,
  AVAILABLE_DOMAINS,
  isValidDomain,
  getDomainDescriptor,
  TOUR_COLOR,
  type DomainKey,
} from "../../shared/domains";

describe("domain registry", () => {
  it("exposes all domain keys", () => {
    expect(DOMAIN_KEYS).toEqual([
      "flight",
      "cruise",
      "lodging",
      "poi",
      "roadtrip",
      "rail",
      "rental",
    ]);
  });

  it("only lists available domains in AVAILABLE_DOMAINS", () => {
    // All five are available (rail since 2026-09-25, hidden in the UI by the
    // `railDomain` beta gate) — `poi` joined when the Places domain replaced the
    // stub. Assert the RELATIONSHIP rather than a frozen list: this test
    // exists to catch a descriptor and the derived list disagreeing, not to
    // count domains. Mirrors frontend/src/__tests__/shared/domains.test.ts.
    expect(AVAILABLE_DOMAINS).toEqual(DOMAIN_KEYS.filter((k) => DOMAINS[k].available));
    expect(AVAILABLE_DOMAINS).toEqual([
      "flight",
      "cruise",
      "lodging",
      "poi",
      "roadtrip",
      "rail",
      "rental",
    ]);
  });

  it("every descriptor has required fields", () => {
    for (const key of DOMAIN_KEYS) {
      const d = DOMAINS[key];
      expect(d.key).toBe(key);
      expect(typeof d.available).toBe("boolean");
      expect(d.i18nKey).toMatch(/^domain\./);
      expect(d.icon).toBeTruthy();
      expect(d.color).toMatch(/^#/);
      expect(d.routePrefix).toMatch(/^\//);
    }
  });

  it("isValidDomain validates strings", () => {
    expect(isValidDomain("flight")).toBe(true);
    expect(isValidDomain("xxx")).toBe(false);
    expect(isValidDomain("")).toBe(false);
  });

  it("getDomainDescriptor returns descriptor or throws on unknown", () => {
    expect(getDomainDescriptor("flight").key).toBe("flight");
    expect(() => getDomainDescriptor("unknown" as DomainKey)).toThrow();
  });
});

/**
 * The backend registry is the half of the mirror nothing else checks: the
 * frontend copy is tied to the generated theme by its own tests, this one only
 * by a comment. Round 29 (forgejo#131) moved rail and roadtrip; a backend left
 * on brick red would hand the old hue to anything that reads the descriptor.
 */
describe("domain colours agree with design/tokens.json", () => {
  const tokens = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../../design/tokens.json"), "utf-8")
  ) as { domainColor: Record<string, string> };
  const tokenName: Record<DomainKey, string> = {
    flight: "flight",
    cruise: "cruise",
    lodging: "hotel",
    poi: "poi",
    roadtrip: "roadtrip",
    rail: "rail",
    rental: "rental",
  };

  it.each(DOMAIN_KEYS)("%s", (key) => {
    expect(DOMAINS[key].color.toLowerCase()).toBe(tokens.domainColor[tokenName[key]].toLowerCase());
  });

  it("tour", () => {
    expect(TOUR_COLOR.toLowerCase()).toBe(tokens.domainColor.tour.toLowerCase());
  });
});
