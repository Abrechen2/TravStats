import { randomUUID } from "crypto";
import { prisma } from "../../db";

export type ConsentState = "unset" | "granted" | "denied";

const VALID_CONSENT: readonly ConsentState[] = ["unset", "granted", "denied"];
const DEFAULT_BASE_URL = "https://stats.travstats.de";

function isConsentState(value: unknown): value is ConsentState {
  return typeof value === "string" && (VALID_CONSENT as readonly string[]).includes(value);
}

/** The AdminSettings singleton is the first row — its id is autoincrement, never 1 by contract. */
async function ensureAdminSettings(): Promise<{ id: number }> {
  const existing = await prisma.adminSettings.findFirst();
  if (existing) return existing;
  return prisma.adminSettings.create({ data: {} });
}

export async function getConsent(): Promise<ConsentState> {
  const row = await prisma.adminSettings.findFirst();
  return isConsentState(row?.usageStatsConsent) ? row.usageStatsConsent : "unset";
}

export async function setConsent(value: ConsentState): Promise<void> {
  if (!isConsentState(value)) {
    throw new Error(`invalid consent value: ${String(value)}`);
  }
  const row = await ensureAdminSettings();
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: { usageStatsConsent: value },
  });
}

export async function getInstallId(): Promise<string | null> {
  const row = await prisma.adminSettings.findFirst();
  return row?.usageStatsInstallId ?? null;
}

/**
 * The anonymous dedup key. A purely random uuid4 — never derived from IP,
 * hostname, MAC, database id, or any filesystem path.
 */
export async function getOrCreateInstallId(): Promise<string> {
  const row = await ensureAdminSettings();
  const existing = await prisma.adminSettings.findFirst();
  if (existing?.usageStatsInstallId) return existing.usageStatsInstallId;

  const newId = randomUUID().replace(/-/g, "");
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: { usageStatsInstallId: newId },
  });
  return newId;
}

/**
 * Base URL of the stats service. An **empty string disables all sending**,
 * regardless of consent — the self-hoster override and kill-switch.
 */
export function getStatsBaseUrl(): string {
  const raw = process.env.TRAVSTATS_STATS_ENDPOINT;
  const value = raw === undefined ? DEFAULT_BASE_URL : raw;
  return value.replace(/\/+$/, "");
}
