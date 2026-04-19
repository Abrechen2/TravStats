import { describe, it, expect } from "vitest";
import { DOMAINS, AVAILABLE_DOMAINS, isValidDomain, DOMAIN_KEYS } from "../../shared/domains";

describe("frontend domain registry", () => {
  it("lists all keys", () => {
    expect(DOMAIN_KEYS).toEqual(["flight", "cruise", "hotel", "poi"]);
  });
  it("exposes AVAILABLE_DOMAINS only with available=true", () => {
    expect(AVAILABLE_DOMAINS).toEqual(["flight"]);
    expect(DOMAINS.flight.available).toBe(true);
    expect(DOMAINS.cruise.available).toBe(false);
  });
  it("isValidDomain", () => {
    expect(isValidDomain("flight")).toBe(true);
    expect(isValidDomain("rockets")).toBe(false);
  });
});
