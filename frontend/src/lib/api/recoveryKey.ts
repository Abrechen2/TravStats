import { api } from "./client";

/** `GET /admin/recovery-key/status` — never carries the key. */
export interface RecoveryKeyStatus {
  backupTargetConfigured: boolean;
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedForOtherKey: boolean;
  /** A backup target exists and the key is unconfirmed: the admin is blocked until confirmed. */
  required: boolean;
  pinnedByEnv: boolean;
}

export interface RevealedRecoveryKey {
  /** Upper-case hex in groups of four. Held in component state only, never stored. */
  key: string;
  fingerprint: string;
  instanceName: string;
  filename: string;
}

export type RecoveryKeyReauth =
  { password: string; code?: string; recoveryCode?: string } | { passkeyResponse: unknown };

/** Fired after anything that can change the status (a WebDAV save, a confirmation). */
export const RECOVERY_KEY_STATUS_EVENT = "travstats:recovery-key-status";

export function announceRecoveryKeyStatusChange(): void {
  window.dispatchEvent(new Event(RECOVERY_KEY_STATUS_EVENT));
}

export const recoveryKeyApi = {
  status: async (): Promise<RecoveryKeyStatus> => {
    const { data } = await api.get<RecoveryKeyStatus>("/admin/recovery-key/status");
    return data;
  },
  /** POST, never GET: the key must not be fetchable by a link or a cache. */
  reveal: async (reauth: RecoveryKeyReauth): Promise<RevealedRecoveryKey> => {
    const { data } = await api.post<RevealedRecoveryKey>("/admin/recovery-key/reveal", reauth);
    return data;
  },
  /** Only the last four characters ever leave the browser for the confirmation. */
  confirm: async (lastFour: string): Promise<RecoveryKeyStatus> => {
    const { data } = await api.post<RecoveryKeyStatus>("/admin/recovery-key/confirm", {
      lastFour,
    });
    return data;
  },
};
