import type { AccountService, AdminService, ServiceQuota } from "../../lib/api/externalServices";

/**
 * Status has dimensions, never one word (spec invariant 3): "Aktiv" is
 * enabled AND configured; enabled without a needed credential is "Schlüssel
 * fehlt"; a failed last test is "Fehler"; an admin "off" is "Aus" whatever
 * else is true of the service.
 */
export type AdminStatus = "active" | "off" | "missing" | "error";

export function adminStatus(service: AdminService): AdminStatus {
  if (!service.enabled) return "off";
  if (!service.configured) return "missing";
  if (service.lastTest && !service.lastTest.ok) return "error";
  return "active";
}

/** The share of a budget already spent, clamped to 0..100; null when it cannot be told. */
export function budgetPercent(quota: ServiceQuota | null): number | null {
  if (!quota || quota.kind !== "budget") return null;
  if (typeof quota.used !== "number" || typeof quota.limit !== "number" || quota.limit <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (quota.used / quota.limit) * 100));
}

export type AccountStatus =
  | "connected"
  | "ownKey"
  | "viaInstance"
  | "off"
  | "notConnected"
  | "noKey"
  | "consented"
  | "notConsented";

export function accountStatus(service: AccountService, kind: "connection" | "key"): AccountStatus {
  if (service.accountDisabled || service.effectiveSource === "off") return "off";
  if (service.effectiveSource === "account") return kind === "connection" ? "connected" : "ownKey";
  if (service.effectiveSource === "instance") {
    return "viaInstance";
  }
  // An own-key row says where requests are served from; "no key" is that answer.
  return kind === "key" ? "noKey" : "notConnected";
}
