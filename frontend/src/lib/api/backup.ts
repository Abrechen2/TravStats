import { api } from "./client";
import type { BackupEntry } from "./types";

export const backupApi = {
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

  create: async (options?: {
    type?: "full" | "partial";
    retentionDays?: number;
  }): Promise<{
    success: boolean;
    backupId: string;
    message: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      backupId: string;
      message: string;
    }>("/backup", options || {});
    return data;
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
      targetDatabaseUrl?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>(`/backup/${id}/restore`, options);
    return data;
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
