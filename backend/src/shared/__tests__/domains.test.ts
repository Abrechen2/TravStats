import { DOMAIN_KEYS, DOMAINS, AVAILABLE_DOMAINS } from "../domains";

describe("lodging domain registration", () => {
  it("replaces the hotel stub with an enabled lodging domain", () => {
    expect(DOMAIN_KEYS).toContain("lodging");
    expect(DOMAIN_KEYS).not.toContain("hotel");
    expect(DOMAINS.lodging.available).toBe(true);
    expect(DOMAINS.lodging.routePrefix).toBe("/lodging");
    // NOTE: AVAILABLE_DOMAINS is `DomainKey[]` (plain keys), not descriptor
    // objects — see dashboardFilterStore.ts / MapChromeSections.tsx, both of
    // which assign/filter it as `DomainKey[]`. The brief's `.map((d) => d.key)`
    // form doesn't match that shape, so this asserts the same intent directly.
    expect(AVAILABLE_DOMAINS).toContain("lodging");
  });
});
