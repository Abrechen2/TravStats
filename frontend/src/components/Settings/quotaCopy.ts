import type { ProviderQuota } from "../../lib/api/settings";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * A provider's quota as one plain sentence, in the reader's language.
 *
 * The cards used to print the plumbing: "Provider liefert keine Quota-Header
 * zurück", and for a count not yet seen "Verbleibend: ? API-Units (zuletzt
 * beobachtet)" — a question mark where a sentence belonged (forgejo#88
 * acceptance, 2026-10-10). An unknown number is now said to be unknown, and
 * when it becomes known.
 */
export function quotaLine(quota: ProviderQuota, t: Translate): string {
  if (quota.kind === "rate_limit_only") return t("settings:apiKeys.quota.rateLimitOnly");
  if (quota.kind === "not_reported") {
    const base = t("settings:apiKeys.quota.notReported");
    return quota.knownLimitHint
      ? `${base} ${t("settings:apiKeys.quota.staticHint", { limit: quota.knownLimitHint })}`
      : base;
  }
  if (quota.remaining === null) return t("settings:apiKeys.quota.unknownYet");
  const main =
    quota.limit !== null
      ? t("settings:apiKeys.quota.remainingOf", { remaining: quota.remaining, limit: quota.limit })
      : t("settings:apiKeys.quota.remainingOnly", { remaining: quota.remaining });
  if (quota.requestsLimit != null && quota.requestsRemaining != null) {
    return `${main} ${t("settings:apiKeys.quota.requestsLine", {
      remaining: quota.requestsRemaining,
      limit: quota.requestsLimit,
    })}`;
  }
  return main;
}
