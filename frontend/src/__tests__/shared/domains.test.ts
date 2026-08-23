import { describe, it, expect } from "vitest";
import { DOMAINS, AVAILABLE_DOMAINS, isValidDomain, DOMAIN_KEYS } from "../../shared/domains";

describe("frontend domain registry", () => {
  it("lists all keys", () => {
    expect(DOMAIN_KEYS).toEqual(["flight", "cruise", "lodging", "poi"]);
  });
  it("exposes AVAILABLE_DOMAINS only with available=true", () => {
    // All four ship now — `poi` joined when the Places domain replaced the
    // stub. The filter is still what AVAILABLE_DOMAINS means, so assert the
    // relationship rather than a frozen list: this test existed to catch a
    // descriptor and the derived list disagreeing, not to count domains.
    expect(AVAILABLE_DOMAINS).toEqual(DOMAIN_KEYS.filter((k) => DOMAINS[k].available));
    expect(AVAILABLE_DOMAINS).toEqual(["flight", "cruise", "lodging", "poi"]);
  });
  it("isValidDomain", () => {
    expect(isValidDomain("flight")).toBe(true);
    expect(isValidDomain("rockets")).toBe(false);
  });
});
