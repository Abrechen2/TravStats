import { describe, it, expect } from "vitest";
import { DOMAINS, AVAILABLE_DOMAINS, isValidDomain, DOMAIN_KEYS } from "../../shared/domains";

describe("frontend domain registry", () => {
  it("lists all keys", () => {
    expect(DOMAIN_KEYS).toEqual(["flight", "cruise", "lodging", "poi"]);
  });
  it("exposes AVAILABLE_DOMAINS only with available=true", () => {
    expect(AVAILABLE_DOMAINS).toEqual(["flight", "cruise", "lodging"]);
    expect(DOMAINS.flight.available).toBe(true);
    expect(DOMAINS.cruise.available).toBe(true);
    expect(DOMAINS.lodging.available).toBe(true);
    expect(DOMAINS.poi.available).toBe(false);
  });
  it("isValidDomain", () => {
    expect(isValidDomain("flight")).toBe(true);
    expect(isValidDomain("rockets")).toBe(false);
  });
});
