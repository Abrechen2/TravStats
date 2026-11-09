import { loadVisibleDomains } from "../domainVisibility";
import type { DomainKey } from "../../shared/domains";

/**
 * What one account may see through the sync feed: its visible domains. `tours`
 * is `tour` among them — the user's switch AND the instance's beta key
 * (`BETA_GATED_DOMAINS`), since tours became a domain (2026-11-09). Switching
 * it changes the fingerprint below, so the phone is told to resync: hidden
 * tours drop out, shown ones are sent again.
 */
export interface SyncScope {
  readonly domains: ReadonlySet<DomainKey>;
  readonly tours: boolean;
}

export async function loadSyncScope(userId: string): Promise<SyncScope> {
  const domains = new Set(await loadVisibleDomains(userId));
  return { domains, tours: domains.has("tour") };
}

/**
 * The scope as a string a cursor can carry.
 *
 * A delta feed can only hide: when a domain is switched ON again, its records
 * have not changed, so no change row will ever bring them to the phone. A
 * cursor minted under another scope is therefore refused with "resync
 * required" instead of answering a feed that silently lacks a whole domain.
 */
export function scopeFingerprint(scope: SyncScope): string {
  return `${[...scope.domains].sort().join(",")}|${scope.tours ? "t" : ""}`;
}
