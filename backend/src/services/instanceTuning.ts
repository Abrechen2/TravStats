/**
 * Instance-wide service settings that code reads synchronously (a header, a
 * URL, a kill-switch) and that used to come from environment variables
 * (forgejo#392). They live in `admin_settings`; this keeps a small snapshot so
 * the call sites stay synchronous. Before the first load every value is "unset",
 * which is the same answer an instance that never set them gives.
 */
import { prisma } from "../db";
import logger from "../utils/logger";
import { decryptApiKey } from "../utils/encryption";

export interface InstanceTuning {
  ownGeoUrl: string | null;
  marketOverpassUrl: string | null;
  railLookupContact: string | null;
  /** null = the official endpoint, "" = never send. */
  usageStatsEndpoint: string | null;
  aisstreamApiKey: string | null;
}

const EMPTY: InstanceTuning = {
  ownGeoUrl: null,
  marketOverpassUrl: null,
  railLookupContact: null,
  usageStatsEndpoint: null,
  aisstreamApiKey: null,
};

const STALE_MS = 30_000;
let snapshot: InstanceTuning = EMPTY;
let loadedAt = 0;
let loading: Promise<void> | null = null;

export async function refreshInstanceTuning(): Promise<void> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: {
      ownGeoUrl: true,
      marketOverpassUrl: true,
      railLookupContact: true,
      usageStatsEndpoint: true,
      globalAisstreamApiKey: true,
    },
  });
  snapshot = {
    ownGeoUrl: row?.ownGeoUrl || null,
    marketOverpassUrl: row?.marketOverpassUrl || null,
    railLookupContact: row?.railLookupContact || null,
    usageStatsEndpoint: row?.usageStatsEndpoint ?? null,
    aisstreamApiKey: row?.globalAisstreamApiKey
      ? decryptApiKey(row.globalAisstreamApiKey) || null
      : null,
  };
  loadedAt = Date.now();
}

/** The current snapshot; a stale one is refreshed in the background, never awaited. */
export function instanceTuning(): InstanceTuning {
  if (Date.now() - loadedAt > STALE_MS && !loading) {
    loadedAt = Date.now();
    loading = refreshInstanceTuning()
      .catch((error) => logger.warn({ error }, "instance tuning refresh failed"))
      .finally(() => {
        loading = null;
      });
  }
  return snapshot;
}

/** Tests: forget the snapshot. */
export function resetInstanceTuning(): void {
  snapshot = EMPTY;
  loadedAt = 0;
  loading = null;
}

/** Tests: pin the snapshot without a database (fresh for the next 30 seconds). */
export function setInstanceTuning(partial: Partial<InstanceTuning>): void {
  snapshot = { ...EMPTY, ...partial };
  loadedAt = Date.now();
}
