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
  const consent: Record<string, { at: string; destination: string }> = {};
  if (o.aiConsent && typeof o.aiConsent === "object") {
    for (const [k, v] of Object.entries(o.aiConsent as Record<string, unknown>)) {
      // A bare date (the shape before consent was bound to its destination)
      // names no endpoint, so it proves consent to none: invalid.
      if (!v || typeof v !== "object") continue;
      const { at, destination } = v as Record<string, unknown>;
      if (typeof at === "string" && typeof destination === "string" && destination) {
        consent[k] = { at, destination };
      }
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

/**
 * Read-modify-write of the policy under a row lock, so two concurrent admin
 * requests cannot overwrite each other's lists.
 */
export async function updatePolicy(
  change: (current: ExternalServicePolicy) => ExternalServicePolicy
): Promise<void> {
  const id = await ensureAdminSettingsRow();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM admin_settings WHERE id = ${id} FOR UPDATE`;
    const row = await tx.adminSettings.findUniqueOrThrow({
      where: { id },
      select: { externalServicePolicy: true },
    });
    const next = change(parsePolicy(row.externalServicePolicy));
    await tx.adminSettings.update({
      where: { id },
      data: { externalServicePolicy: next as unknown as object },
    });
  });
}

export async function savePolicy(policy: ExternalServicePolicy): Promise<void> {
  await updatePolicy(() => policy);
}

export async function loadPrefs(userId: string): Promise<ExternalServicePrefs> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { externalServicePrefs: true },
  });
  return parsePrefs(row?.externalServicePrefs);
}

/**
 * Read-modify-write of one account's preferences under a row lock — a consent
 * revoked in one request must not be restored by a concurrent save.
 */
export async function updatePrefs(
  userId: string,
  change: (current: ExternalServicePrefs) => ExternalServicePrefs
): Promise<ExternalServicePrefs> {
  return prisma.$transaction(async (tx) => {
    await tx.userSettings.upsert({
      where: { userId },
      create: { userId, data: {} },
      update: {},
    });
    await tx.$queryRaw`SELECT user_id FROM user_settings WHERE user_id = ${userId} FOR UPDATE`;
    const row = await tx.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { externalServicePrefs: true },
    });
    const next = change(parsePrefs(row.externalServicePrefs));
    await tx.userSettings.update({
      where: { userId },
      data: { externalServicePrefs: next as unknown as object },
    });
    return next;
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

/** The subset of `userIds` for whom connection `id` is neither switched off nor forbidden. */
export async function filterConnectionAllowed(id: string, userIds: string[]): Promise<string[]> {
  const policy = await loadPolicy();
  if (policy.disabled.includes(id) || policy.connectionsForbidden.includes(id)) return [];
  if (userIds.length === 0) return [];
  const rows = await prisma.userSettings.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, externalServicePrefs: true },
  });
  const off = new Set(
    rows
      .filter((r) => parsePrefs(r.externalServicePrefs).disabled.includes(id))
      .map((r) => r.userId)
  );
  return userIds.filter((u) => !off.has(u));
}
