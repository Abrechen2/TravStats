/**
 * Resolves which loyalty programme a stay ran under, server-side.
 *
 * This is the FIRST runtime consumer of `shared/membershipDerivation.ts` on the
 * server — the note at the top of that module foresaw exactly this ("if a
 * server-side consumer is ever added… keep it and the migration's SQL logic in
 * step by hand"). It deliberately calls `deriveStayMembership` rather than
 * re-implementing the rule, so the server, the client and the migration all
 * answer the same question the same way.
 *
 * It exists as its own module because two callers need it — the lodging stats
 * endpoint and the achievement rollup — and a copy in each is how the two
 * would come to disagree about whose nights count toward a status.
 */
import {
  deriveStayMembership,
  type MembershipCoverage,
} from "../../shared/membershipDerivation";

/** The shape a `LodgingMembership` must be loaded in for this to work. */
export interface MembershipWithLinks {
  id: string;
  programName: string;
  tier: string | null;
  createdAt: Date;
  chains: { chainId: number }[];
  lodgings: { lodgingId: string }[];
}

export interface ResolvedProgramme {
  programName: string | null;
  tier: string | null;
}

const NO_PROGRAMME: ResolvedProgramme = { programName: null, tier: null };

export interface StayMembershipContext {
  coverage: MembershipCoverage[];
  byId: Map<string, MembershipWithLinks>;
}

/**
 * Builds the lookup once per request. Called with every membership the user
 * has; a user with none yields an empty context, and every stay then resolves
 * to no programme without any special-casing at the call site.
 */
export function buildMembershipContext(
  memberships: MembershipWithLinks[],
): StayMembershipContext {
  return {
    coverage: memberships.map((m) => ({
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      chainIds: m.chains.map((c) => c.chainId),
      lodgingIds: m.lodgings.map((l) => l.lodgingId),
    })),
    byId: new Map(memberships.map((m) => [m.id, m])),
  };
}

/**
 * The programme a stay ran under, or nulls when none did.
 *
 * `membershipId` on the stay is an OVERRIDE, not the answer: a card attached to
 * a chain covers every stay at that chain without the user restating it. The
 * tier travels with the name because a status figure without its tier says
 * only half of what the user is tracking.
 */
export function resolveStayProgramme(
  stay: { membershipId: string | null; membershipOptOut: boolean; lodgingId: string },
  lodgingChainId: number | null,
  context: StayMembershipContext,
): ResolvedProgramme {
  const { membershipId } = deriveStayMembership({
    overrideId: stay.membershipId,
    optOut: stay.membershipOptOut,
    lodgingId: stay.lodgingId,
    lodgingChainId,
    memberships: context.coverage,
  });
  if (membershipId === null) return NO_PROGRAMME;
  const membership = context.byId.get(membershipId);
  // deriveStayMembership only ever returns an id it was given, so a miss here
  // would mean the two structures were built from different lists.
  if (!membership) return NO_PROGRAMME;
  return { programName: membership.programName, tier: membership.tier };
}
