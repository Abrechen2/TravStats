import type {
  AccountService,
  AdminService,
  ServiceField,
  ServiceQuota,
} from "../../lib/api/externalServices";

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

export type StatusFilter = "all" | "recommended" | "active" | "attention" | "off";

export function matchesFilter(
  filter: StatusFilter,
  status: AdminStatus,
  recommended: AdminService["recommended"]
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "recommended":
      return recommended !== null;
    case "active":
      return status === "active";
    case "off":
      return status === "off";
    case "attention":
      return status === "missing" || status === "error";
  }
}

export interface StatusCounts {
  active: number;
  attention: number;
  off: number;
}

export function countStatuses(statuses: readonly AdminStatus[]): StatusCounts {
  const counts: StatusCounts = { active: 0, attention: 0, off: 0 };
  for (const status of statuses) {
    if (status === "active") counts.active += 1;
    else if (status === "off") counts.off += 1;
    else counts.attention += 1;
  }
  return counts;
}

/** The share of a budget already spent, clamped to 0..100; null when it cannot be told. */
export function budgetPercent(quota: ServiceQuota | null): number | null {
  if (!quota || quota.kind !== "budget") return null;
  if (typeof quota.used !== "number" || typeof quota.limit !== "number" || quota.limit <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (quota.used / quota.limit) * 100));
}

/** Two letters for the row's monogram: the capitals of the name, else its first letters. */
export function initialsOf(name: string): string {
  const words = name.split(/[\s&()+·.-]+/).filter(Boolean);
  const caps = words.map((word) => word[0]?.toUpperCase() ?? "").join("");
  const pick = words.length >= 2 ? caps : (words[0] ?? "").slice(0, 2).toUpperCase();
  return pick.slice(0, 2);
}

/** Fields the standard view shows: everything that is not expert plumbing. */
export function visibleFields(fields: readonly ServiceField[], expert: boolean): ServiceField[] {
  return expert ? [...fields] : fields.filter((field) => !field.expert);
}

export function hasHiddenExpertFields(fields: readonly ServiceField[], expert: boolean): boolean {
  return !expert && fields.some((field) => field.expert);
}

export type AccountStatus =
  "connected" | "ownKey" | "viaInstance" | "off" | "notConnected" | "consented" | "notConsented";

export function accountStatus(service: AccountService, kind: "connection" | "key"): AccountStatus {
  if (service.accountDisabled || service.effectiveSource === "off") return "off";
  if (service.effectiveSource === "account") return kind === "connection" ? "connected" : "ownKey";
  if (service.effectiveSource === "instance" || service.effectiveSource === "env") {
    return "viaInstance";
  }
  return "notConnected";
}
