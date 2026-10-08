import { describe, expect, it } from "vitest";

import { canonicalRoutePair, routePairKey } from "../routePair";

/**
 * Forgejo #254. A connection is the UNORDERED airport pair: HNL-OGG and
 * OGG-HNL are one connection. `/stats/routes`, the Route Master fun fact, the
 * Wrapped top route and the "same route" badge all key on this one function.
 *
 * Frontend MIRROR of `backend/src/shared/__tests__/routePair.test.ts` (which
 * tests `backend/src/shared/routePair.ts`) - the same truth table.
 */
describe("routePair", () => {
  it("sorts the two codes so both directions share one pair", () => {
    expect(canonicalRoutePair("OGG", "HNL")).toEqual(["HNL", "OGG"]);
    expect(canonicalRoutePair("HNL", "OGG")).toEqual(["HNL", "OGG"]);
  });

  it("keys both directions identically", () => {
    expect(routePairKey("HNL", "OGG")).toBe("HNL-OGG");
    expect(routePairKey("OGG", "HNL")).toBe("HNL-OGG");
  });

  it("reads codes case- and whitespace-insensitively", () => {
    expect(routePairKey(" ogg", "hnl ")).toBe("HNL-OGG");
  });

  it("abstains when either end is unknown, instead of inventing a 'null' airport", () => {
    expect(routePairKey(null, "HNL")).toBeNull();
    expect(routePairKey("HNL", undefined)).toBeNull();
    expect(routePairKey("", "HNL")).toBeNull();
    expect(routePairKey("  ", "HNL")).toBeNull();
  });

  it("keeps a same-airport pair as one pair", () => {
    expect(routePairKey("FRA", "FRA")).toBe("FRA-FRA");
  });
});
