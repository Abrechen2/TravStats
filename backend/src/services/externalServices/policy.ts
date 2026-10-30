/**
 * Admin policy and per-account preferences for external services (forgejo#392).
 *
 * Absent = allowed / enabled, so an instance that never opened the new page
 * behaves exactly as before. Both documents are JSONB; every read goes through
 * the parsers below because a column written by a newer or older build must
 * never crash a request that only wanted a key.
 */
import { prisma } from "../../db";
import { ensureAdminSettingsRow } from "../adminSettingsRow";
import type { ExternalServicePolicy, ExternalServicePrefs } from "./types";

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function parsePolicy(raw: unknown): ExternalServicePolicy {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    disabled: strings(o.disabled),
    accountKeysForbidden: strings(o.accountKeysForbidden),
    connectionsForbidden: strings(o.connectionsForbidden),
  };
}

export function parsePrefs(raw: unknown): ExternalServicePrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const consent: Record<string, string> = {};
  if (o.aiConsent && typeof o.aiConsent === "object") {
    for (const [k, v] of Object.entries(o.aiConsent as Record<string, unknown>)) {
      if (typeof v === "string") consent[k] = v;
    }
  }
  return { disabled: strings(o.disabled), aiConsent: consent };
}

export async function loadPolicy(): Promise<ExternalServicePolicy> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { externalServicePolicy: true },
  });
  return parsePolicy(row?.externalServicePolicy);
}

export async function savePolicy(policy: ExternalServicePolicy): Promise<void> {
  await prisma.adminSettings.update({
    where: { id: await ensureAdminSettingsRow() },
    data: { externalServicePolicy: policy as unknown as object },
  });
}

export async function loadPrefs(userId: string): Promise<ExternalServicePrefs> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { externalServicePrefs: true },
  });
  return parsePrefs(row?.externalServicePrefs);
}

export async function savePrefs(userId: string, prefs: ExternalServicePrefs): Promise<void> {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, data: {}, externalServicePrefs: prefs as unknown as object },
    update: { externalServicePrefs: prefs as unknown as object },
  });
}

/** `list` with `id` present (on) or absent, as a new array. */
export function withMember(list: readonly string[], id: string, present: boolean): string[] {
  const rest = list.filter((x) => x !== id);
  return present ? [...rest, id] : rest;
}

export async function isServiceDisabledByAdmin(id: string): Promise<boolean> {
  return (await loadPolicy()).disabled.includes(id);
}

/** Why a service is off for this caller, or null when it may be used. */
export type OffReason = "admin" | "account";
export async function offReasonFor(id: string, userId?: string): Promise<OffReason | null> {
  if ((await loadPolicy()).disabled.includes(id)) return "admin";
  if (userId && (await loadPrefs(userId)).disabled.includes(id)) return "account";
  return null;
}

/**
 * The policy for a connection (Immich, Dawarich, …) for one caller:
 * `off` = nothing may be resolved (admin off for everyone, or this account
 * switched it off); `accountMayConnect` = the account's own connection may be
 * used at all (the admin can forbid accounts to connect their own).
 */
export async function connectionGate(
  id: string,
  userId?: string
): Promise<{ off: OffReason | null; accountMayConnect: boolean }> {
  const policy = await loadPolicy();
  if (policy.disabled.includes(id)) return { off: "admin", accountMayConnect: false };
  if (userId && (await loadPrefs(userId)).disabled.includes(id)) {
    return { off: "account", accountMayConnect: false };
  }
  return { off: null, accountMayConnect: !policy.connectionsForbidden.includes(id) };
}
