import { getInstanceSettings } from "../instanceSettingsService";
import { loadVisibleDomains } from "../domainVisibility";
import type { DomainKey } from "../../shared/domains";

/**
 * What one account may see through the sync feed: its visible domains, plus
 * whether tours are shown (they follow the instance's beta switch, the same
 * key the web's `useToursVisible` reads — `BETA_GATED_DOMAINS` in
 * `domainVisibility.ts`).
 */
export interface SyncScope {
  readonly domains: ReadonlySet<DomainKey>;
  readonly tours: boolean;
}

export async function loadSyncScope(userId: string): Promise<SyncScope> {
  const [domains, instance] = await Promise.all([
    loadVisibleDomains(userId),
    getInstanceSettings(),
  ]);
  return { domains: new Set(domains), tours: instance.betaFeaturesEnabled };
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
