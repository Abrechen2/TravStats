import { api } from "./client";
import { JobFailedError } from "./jobs";

/**
 * The account's WebDAV sync of its own data export (forgejo#321) —
 * `/settings/webdav-sync`. The password is write-only: the server answers
 * `hasPassword`, never the value.
 */

export const WEBDAV_SYNC_ERROR_CODES = [
  "notConfigured",
  "invalidUrl",
  "httpsRequired",
  "blockedTarget",
  "auth",
  "unreachable",
  "timeout",
  "tls",
  "quota",
  "tooLarge",
  "path",
  "server",
  "protocol",
  "cleanupIncomplete",
  "alreadyRunning",
  "invalidInput",
  /** Not the share's: our own limiter (10 runs per 15 minutes), answered 429. */
  "rateLimited",
] as const;

export type WebdavSyncErrorCode = (typeof WEBDAV_SYNC_ERROR_CODES)[number];

export type WebdavSchedule = "daily" | "weekly";

export interface WebdavSyncStatus {
  enabled: boolean;
  url: string | null;
  username: string | null;
  hasPassword: boolean;
  remotePath: string;
  schedule: WebdavSchedule;
  keepVersions: number;
  /** When the last run was attempted. */
  ranAt: string | null;
  /** When a run last succeeded. */
  completedAt: string | null;
  lastStatus: "ok" | "partial" | "failed" | null;
  lastErrorCode: string | null;
  lastFileName: string | null;
  lastSizeBytes: number | null;
  running: boolean;
  /** An admin account may name a LAN share; everyone else public https only. */
  allowPrivateTargets: boolean;
}

export interface WebdavSyncUpdate {
  enabled?: boolean;
  url?: string | null;
  username?: string | null;
  /** Absent keeps the stored password; null removes it. */
  password?: string | null;
  remotePath?: string;
  schedule?: WebdavSchedule;
  keepVersions?: number;
}

/** The i18n key for a failure code; an unknown one gets the generic line. */
export function webdavErrorKey(code: string | null | undefined): string {
  return code && (WEBDAV_SYNC_ERROR_CODES as readonly string[]).includes(code)
    ? `settings:webdavSync.errors.${code}`
    : "settings:webdavSync.errors.unknown";
}

/** The code a refused request carries in `error`, or null for anything else. */
export function webdavRequestErrorCode(err: unknown): string | null {
  if (err instanceof JobFailedError) return err.code;
  if ((err as { response?: { status?: number } } | undefined)?.response?.status === 429) {
    return "rateLimited";
  }
  const data = (err as { response?: { data?: { error?: unknown } } } | undefined)?.response?.data;
  const code = data?.error;
  return typeof code === "string" && (WEBDAV_SYNC_ERROR_CODES as readonly string[]).includes(code)
    ? code
    : null;
}

export const webdavSyncApi = {
  get: async (): Promise<WebdavSyncStatus> => {
    const { data } = await api.get<WebdavSyncStatus>("/settings/webdav-sync");
    return data;
  },
  update: async (payload: WebdavSyncUpdate): Promise<WebdavSyncStatus> => {
    const { data } = await api.put<WebdavSyncStatus>("/settings/webdav-sync", payload);
    return data;
  },
};
