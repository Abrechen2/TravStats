export interface Backup {
  id: string;
  type: string;
  status: string;
  backupPath: string;
  size: string;
  retentionDays: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  /** Why a failed backup failed — a code, worded by `backupRowFailureKey`. */
  errorCode?: string | null;
  metadata: Record<string, unknown> | null;
  syncedToCloud: boolean;
  cloudSyncAt: string | null;
  cloudSyncError: string | null;
  cloudTarget?: string | null;
  cloudDeleteError?: string | null;
  createdAt: string;
  fileExists?: boolean;
}
