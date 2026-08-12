/**
 * Which loyalty card applies to a stay. The stored `membership_id` on a stay
 * is an OVERRIDE, not the answer — the answer is derived from the hotel it
 * belongs to, so a card attached to a chain covers every stay at that chain
 * without the user restating it per stay.
 *
 * MIRRORED in `frontend/src/shared/membershipDerivation.ts` (the convention of
 * shared/domains.ts, shared/statusDerivation.ts and shared/ratingDerivation.ts)
 * because the stay editor shows the reader the same card the server resolves.
 * Both sides are covered by tests asserting the same truth table.
 *
 * IMPORTANT — this module has NO runtime consumer on the server today.
 * Nothing outside its own test imports `deriveStayMembership` from here: the
 * server only ever stores the override (`membership_id` / `membership_opt_out`
 * on `lodging_stays`), and the one place this exact rule had to be
 * reproduced server-side was the migration
 * (`prisma/migrations/20260809104800_membership_lodging_links/migration.sql`),
 * written directly in SQL rather than by calling this function. That means
 * the two mirrored copies (this file and the frontend one) are kept honest
 * ONLY by their duplicated truth tables in each side's tests — there is no
 * shared runtime path enforcing agreement. If a server-side consumer of
 * `deriveStayMembership` is ever added (e.g. an API response that resolves
 * the effective membership), keep it and the migration's SQL logic in step
 * by hand; nothing currently does that automatically.
 *
 * WHY THE MIGRATION'S SQL TIE-BREAK MATCHES `oldest()` BELOW: both pick the
 * smallest `(created_at, id)`, and the SQL breaks the `created_at` tie with a
 * plain `<` on `id`. That agrees with this file's JS comparison ONLY because
 * every `id` here is a `uuid()` default (see schema.prisma) — a fixed-length,
 * lowercase-hex string with hyphens at fixed positions (8-4-4-4-12). Over that
 * fixed character set, JS's UTF-16 `<` and Postgres's text collation order
 * every pair of ids identically, so the two languages cannot disagree on which
 * id is "smaller". If the id format ever changes (different casing, a prefix,
 * a non-hex alphabet), that equivalence needs re-checking — it is not a
 * general property of `<` on strings.
 *
 * This note lives here rather than in the migration because the migration has
 * been applied on running instances and Prisma records a checksum of the file:
 * editing it, even in a comment, makes `migrate deploy` report the migration
 * as modified.
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
 *
 * Two cards can share the same `createdAt` (e.g. both created in one
 * transaction), so `createdAt` alone is not a total order. Ties break on the
 * lexicographically smaller `id` — arbitrary, but fixed, so the result still
 * never depends on array order.
 */
function oldest(candidates: MembershipCoverage[]): MembershipCoverage | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => {
    if (c.createdAt !== best.createdAt) return c.createdAt < best.createdAt ? c : best;
    return c.id < best.id ? c : best;
  });
}

export function deriveStayMembership(
  input: StayMembershipInput,
): StayMembershipResolution {
  if (input.optOut) return { membershipId: null, source: "none" };

  // A stale override (the card was deleted) must fall through to derivation
  // rather than naming a membership that no longer exists.
  if (input.overrideId !== null) {
    const hit = input.memberships.find((m) => m.id === input.overrideId);
    if (hit) return { membershipId: hit.id, source: "override" };
  }

  if (input.lodgingChainId !== null) {
    const byChain = oldest(
      input.memberships.filter((m) =>
        m.chainIds.includes(input.lodgingChainId as number),
      ),
    );
    if (byChain) return { membershipId: byChain.id, source: "chain" };
  }

  const byLodging = oldest(
    input.memberships.filter((m) => m.lodgingIds.includes(input.lodgingId)),
  );
  if (byLodging) return { membershipId: byLodging.id, source: "lodging" };

  return { membershipId: null, source: "none" };
}
