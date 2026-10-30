/**
 * Quota of a service, where TravStats actually knows it (forgejo#392).
 * Unknown stays null — a hint from the provider's pricing page is not a measurement.
 */
import { getAeroapiUsage } from "../aeroapiBudget";
import { getProviderQuota } from "../apiQuota";
import type { ServiceDef } from "./types";

export interface QuotaView {
  kind: "budget" | "monthly" | "daily" | "rateLimit" | "none";
  used?: number;
  limit?: number;
  unit?: string;
  resetsAt?: string;
}

function nextMonthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export async function quotaFor(service: ServiceDef, userId?: string): Promise<QuotaView | null> {
  if (service.id === "aeroapi" && !userId) {
    const usage = await getAeroapiUsage();
    return {
      kind: "budget",
      used: usage.spentUsd,
      limit: usage.budgetUsd,
      unit: "USD",
      resetsAt: nextMonthStartUtc(new Date()),
    };
  }
  if (!service.quotaProvider) return null;
  const quota = getProviderQuota(service.quotaProvider, userId);
  if (quota.kind === "rate_limit_only") return { kind: "rateLimit" };
  if (quota.kind === "observed" && quota.limit !== null && quota.remaining !== null) {
    return {
      kind: "monthly",
      used: Math.max(0, quota.limit - quota.remaining),
      limit: quota.limit,
      unit: "units",
    };
  }
  return null;
}
