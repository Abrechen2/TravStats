import type { DomainKey } from "../../shared/domains";

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
