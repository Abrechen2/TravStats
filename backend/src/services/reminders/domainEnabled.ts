import type { DomainKey } from "../../shared/domains";
import { BETA_GATED_DOMAINS } from "../domainVisibility";

/**
 * Whether a reminder MAIL for this domain should reach this user: only for a
 * domain the user has switched on (`UserSettings.enabledDomains`).
 *
 * A user who turned cruises off still owns the cruises logged before that —
 * the app hides them, and a mail announcing one would be the only place the
 * domain still speaks. An account without a settings row has the schema
 * default, which is flights only.
 */
export function reminderDomainEnabled(
  settings: { enabledDomains?: string[] | null } | null | undefined,
  domain: DomainKey
): boolean {
  const enabled = settings?.enabledDomains ?? ["flight"];
  return enabled.includes(domain);
}

/**
 * `reminderDomainEnabled`, and the instance shows the domain at all: a domain
 * behind the beta switch (`BETA_GATED_DOMAINS`) sends no mail on an instance
 * whose switch is off — the mail would announce an entry the app hides.
 */
export function reminderDomainVisible(
  settings: { enabledDomains?: string[] | null } | null | undefined,
  domain: DomainKey,
  betaFeaturesEnabled: boolean
): boolean {
  const gated = BETA_GATED_DOMAINS[domain] !== undefined;
  return reminderDomainEnabled(settings, domain) && (!gated || betaFeaturesEnabled);
}
