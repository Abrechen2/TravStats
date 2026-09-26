import { api } from "./client";
import type { BackupEntry } from "./types";

export interface BackupScheduleSettings {
  backupEnabled: boolean;
  backupInterval: "daily" | "weekly" | "monthly";
  backupRetentionDays: number;
}

export const backupApi = {
  getBackupSettings: async (): Promise<BackupScheduleSettings> => {
    const { data } = await api.get<BackupScheduleSettings>("/admin/backup-settings");
    return data;
  },

  updateBackupSettings: async (
    settings: Partial<BackupScheduleSettings>
  ): Promise<BackupScheduleSettings> => {
    const { data } = await api.put<BackupScheduleSettings>("/admin/backup-settings", settings);
    return data;
  },

  list: async (): Promise<{
    backups: BackupEntry[];
  }> => {
    const { data } = await api.get<{
      backups: BackupEntry[];
    }>("/backup");
    return data;
  },

  get: async (
    id: string
  ): Promise<{
    backup: BackupEntry;
  }> => {
    const { data } = await api.get<{
      backup: BackupEntry;
    }>(`/backup/${id}`);
    return data;
  },

  /**
   * Start a backup. Answers at once with a job (the dump and the archive take
   * minutes); `waitForJob` reads the outcome.
   */
  create: async (options?: {
    type?: "full" | "partial";
    retentionDays?: number;
  }): Promise<{ jobId: string; backupId: string }> => {
    const { data } = await api.post<{
      success: boolean;
      data: { jobId: string; backupId: string };
    }>("/backup", options || {});
    return data.data;
  },

  download: async (id: string): Promise<Blob> => {
    const response = await api.get<Blob>(`/backup/${id}/download`, {
      responseType: "blob",
    });
    return response.data;
  },

  restore: async (
    id: string,
    options: {
      scope: "full" | "database" | "files";
      createBackupBefore?: boolean;
      /**
       * Sent only on the second attempt, after the server refused the first
       * with `RESTORE_ENCRYPTION_KEY_MISMATCH` and the admin acknowledged that
       * the stored credentials in the archive will not decrypt here.
       */
      acceptEncryptionKeyChange?: boolean;
    }
  ): Promise<{ jobId: string }> => {
    // A job, like `create`: the preflight refusals (RESTORE_*) arrive as the
    // job's error code rather than as this response.
    const { data } = await api.post<{ success: boolean; data: { jobId: string } }>(
      `/backup/${id}/restore`,
      options
    );
    return data.data;
  },

  delete: async (
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> => {
    const { data } = await api.delete<{
      success: boolean;
      message: string;
    }>(`/backup/${id}`);
    return data;
  },

  getStatus: async (): Promise<{
    running: boolean;
    currentBackup: {
      id: string;
      status: string;
      startedAt: string | null;
    } | null;
  }> => {
    const { data } = await api.get<{
      running: boolean;
      currentBackup: {
        id: string;
        status: string;
        startedAt: string | null;
      } | null;
    }>("/backup/status");
    return data;
  },

  cleanup: async (): Promise<{
    success: boolean;
    deletedCount: number;
    message: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      deletedCount: number;
      message: string;
    }>("/backup/cleanup");
    return data;
  },

  syncToCloud: async (
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>(`/backup/${id}/sync`);
    return data;
  },

  listCloudBackups: async (): Promise<{
    backups: Array<{
      name: string;
      size: number;
      lastModified: string;
    }>;
  }> => {
    const { data } = await api.get<{
      backups: Array<{
        name: string;
        size: number;
        lastModified: string;
      }>;
    }>("/backup/cloud/list");
    return data;
  },

  testCloudConnection: async (): Promise<{
    success: boolean;
    message: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>("/backup/cloud/test");
    return data;
  },

  downloadFromCloud: async (
    backupName: string
  ): Promise<{
    success: boolean;
    message: string;
    localPath: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
      localPath: string;
    }>("/backup/cloud/download", { backupName });
    return data;
  },
};
