/**
 * Frontend MIRROR of `backend/src/shared/membershipDerivation.ts`, following
 * the same convention as shared/domains.ts, shared/statusDerivation.ts and
 * shared/ratingDerivation.ts.
 *
 * The rules MUST stay identical to the backend. Both sides are covered by
 * tests asserting the same truth table.
 */

export type StayMembershipSource = "override" | "chain" | "lodging" | "none";

export interface MembershipCoverage {
  id: string;
  /** ISO string. Used only for the overlap tie-break below. */
  createdAt: string;
  chainIds: number[];
  lodgingIds: string[];
}

export interface StayMembershipResolution {
  membershipId: string | null;
  source: StayMembershipSource;
}

export interface StayMembershipInput {
  /** The stay's stored override, or null to derive. */
  overrideId: string | null;
  /** true = the user explicitly used NO programme for this stay. */
  optOut: boolean;
  lodgingId: string;
  lodgingChainId: number | null;
  memberships: MembershipCoverage[];
}

/**
 * An overlap (two cards covering the same chain or hotel) resolves to the
 * OLDEST card, so the answer does not depend on query order and cannot change
 * between two requests. The settings list is where the user untangles it.
 */
function oldest(candidates: MembershipCoverage[]): MembershipCoverage | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.createdAt < best.createdAt ? c : best));
}

export function deriveStayMembership(input: StayMembershipInput): StayMembershipResolution {
  if (input.optOut) return { membershipId: null, source: "none" };

  // A stale override (the card was deleted) must fall through to derivation
  // rather than naming a membership that no longer exists.
  if (input.overrideId !== null) {
    const hit = input.memberships.find((m) => m.id === input.overrideId);
    if (hit) return { membershipId: hit.id, source: "override" };
  }

  if (input.lodgingChainId !== null) {
    const byChain = oldest(
      input.memberships.filter((m) => m.chainIds.includes(input.lodgingChainId as number))
    );
    if (byChain) return { membershipId: byChain.id, source: "chain" };
  }

  const byLodging = oldest(input.memberships.filter((m) => m.lodgingIds.includes(input.lodgingId)));
  if (byLodging) return { membershipId: byLodging.id, source: "lodging" };

  return { membershipId: null, source: "none" };
}
