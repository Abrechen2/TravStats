import { describe, expect, it } from "vitest";
import { deriveStayMembership, type MembershipCoverage } from "../membershipDerivation";

/**
 * The SAME truth table as `backend/src/shared/__tests__/membershipDerivation.test.ts`.
 * The editor must resolve exactly the card the server resolves; these two
 * suites disagreeing is the failure this mirror exists to catch.
 */

const chainCard: MembershipCoverage = {
  id: "m-chain",
  createdAt: "2026-01-01T00:00:00.000Z",
  chainIds: [7],
  lodgingIds: [],
};
const hotelCard: MembershipCoverage = {
  id: "m-hotel",
  createdAt: "2026-01-02T00:00:00.000Z",
  chainIds: [],
  lodgingIds: ["lodging-1"],
};

const base = {
  overrideId: null,
  optOut: false,
  lodgingId: "lodging-1",
  lodgingChainId: null as number | null,
  memberships: [chainCard, hotelCard],
};

describe("deriveStayMembership", () => {
  it("uses the card covering the hotel's chain", () => {
    expect(deriveStayMembership({ ...base, lodgingChainId: 7 })).toEqual({
      membershipId: "m-chain",
      source: "chain",
    });
  });

  it("falls back to a card covering the hotel itself when it has no chain", () => {
    expect(deriveStayMembership(base)).toEqual({
      membershipId: "m-hotel",
      source: "lodging",
    });
  });

  it("lets a chain link win over a direct hotel link", () => {
    // The "only when no chain is set" rule is PRECEDENCE, not prohibition:
    // assigning a chain later makes the direct link dormant, never invalid.
    const both = { ...base, lodgingChainId: 7 };
    expect(deriveStayMembership(both).source).toBe("chain");
  });

  it("lets an explicit override win over any derived card", () => {
    expect(deriveStayMembership({ ...base, lodgingChainId: 7, overrideId: "m-hotel" })).toEqual({
      membershipId: "m-hotel",
      source: "override",
    });
  });

  it("lets opt-out win over everything, including an override", () => {
    expect(
      deriveStayMembership({ ...base, lodgingChainId: 7, overrideId: "m-hotel", optOut: true })
    ).toEqual({ membershipId: null, source: "none" });
  });

  it("resolves an overlap to the OLDEST card, so the answer is stable", () => {
    const younger: MembershipCoverage = {
      id: "m-younger",
      createdAt: "2026-05-01T00:00:00.000Z",
      chainIds: [7],
      lodgingIds: [],
    };
    // Order in the array must not decide the winner.
    expect(
      deriveStayMembership({ ...base, lodgingChainId: 7, memberships: [younger, chainCard] })
        .membershipId
    ).toBe("m-chain");
  });

  it("is none when nothing covers the stay", () => {
    expect(deriveStayMembership({ ...base, lodgingId: "lodging-9", lodgingChainId: 99 })).toEqual({
      membershipId: null,
      source: "none",
    });
  });

  it("ignores an override id that is not one of the user's cards", () => {
    // A stale id (the card was deleted) must fall through to derivation
    // rather than resolving to a membership that no longer exists.
    expect(
      deriveStayMembership({ ...base, lodgingChainId: 7, overrideId: "m-deleted" }).source
    ).toBe("chain");
  });
});
