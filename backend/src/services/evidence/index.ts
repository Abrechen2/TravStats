import type { EvidenceKind, EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";

/**
 * A resolver answers one `EvidenceKind` for one user. `null` means the key
 * names nothing this resolver serves — the route turns that into 404, the
 * same answer an unregistered kind gets, so a caller cannot distinguish
 * "unknown kind" from "unknown key" and neither can leak which is which.
 *
 * Every resolver receives `userId` and must scope its own query by it — the
 * dispatcher does not, and cannot, check that a resolver honoured it.
 */
export type EvidenceResolver = (
  userId: string,
  key: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse | null>;

export type EvidenceResolverMap = Partial<Record<EvidenceKind, EvidenceResolver>>;

/**
 * Empty by construction. Release 1's first resolver arrives in Task 5 — see
 * `.superpowers/sdd/2026-09-18-evidence-panel/task-3-brief.md`'s ruling on
 * this task: a fake resolver shipped here to make a test pass is exactly
 * what that ruling forbids. Until Task 5 lands, every `metric`/`ranking`
 * request answers `unknownKey` (404) through the same empty-map path a
 * genuinely unknown key would.
 */
export const DEFAULT_RESOLVERS: EvidenceResolverMap = {};

export type EvidenceResolution =
  | { status: "ok"; response: EvidenceResponse }
  | { status: "unknownKey" }
  | { status: "unservedKind" };

/**
 * `record` and `achievement` are unserved for the whole of release 1
 * (`docs/superpowers/specs/2026-09-18-evidence-panel-design.md`, "Release
 * 2"), independent of the resolver map — even a test that injects a fake
 * resolver for one of these two still gets `unservedKind`, so the route's
 * 501 is a release fact, not an accident of which resolvers happen to be
 * wired.
 */
const UNSERVED_IN_RELEASE_1: ReadonlySet<EvidenceKind> = new Set(["record", "achievement"]);

/**
 * Dispatches to the resolver for `kind`, injectable so unit tests can prove
 * the 0-case and the null-case against fakes without a real resolver
 * existing yet (see the brief's ruling, quoted above).
 */
export async function resolveEvidence(
  userId: string,
  kind: EvidenceKind,
  key: string,
  scope: EvidenceScope,
  page: PagingParams,
  resolvers: EvidenceResolverMap = DEFAULT_RESOLVERS
): Promise<EvidenceResolution> {
  if (UNSERVED_IN_RELEASE_1.has(kind)) return { status: "unservedKind" };

  const resolve = resolvers[kind];
  if (!resolve) return { status: "unknownKey" };

  const response = await resolve(userId, key, scope, page);
  if (response === null) return { status: "unknownKey" };
  return { status: "ok", response };
}
