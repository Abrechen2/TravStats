import * as fs from "fs";
import * as path from "path";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { downloadFromCloud } from "../cloudSyncService";
import { BACKUP_BASE_DIR } from "./backupConfig";

/** The retention a downloaded backup carries until the admin changes it. */
const DEFAULT_RETENTION_DAYS = 30;

export interface CloudBackupImportResult {
  backupId: string;
  /** The bytes matched a checksum stored beside the upload. False: the
   *  archive predates checksums and was accepted on its size alone. */
  verified: boolean;
}

/** The backup id a share file becomes: its name without `.tar.gz`. */
export const backupIdOfCloudName = (backupName: string): string =>
  backupName.replace(/\.tar\.gz$/, "");

/**
 * Refuse before any byte moves when the name is already a backup here: a
 * second copy would either overwrite an archive the admin can restore from or
 * leave a file no row describes.
 */
export async function assertCloudBackupNotPresent(backupName: string): Promise<void> {
  // TravStats names its archives `backup-<timestamp>`. The prefix also keeps a
  // share file from claiming an internal directory such as `restore-temp`,
  // which every restore empties.
  if (!/^backup-[a-zA-Z0-9._-]+\.tar\.gz$/.test(backupName)) {
    throw new AppError("Invalid backupName", 400);
  }
  const id = backupIdOfCloudName(backupName);
  const existing = await prisma.backup.findUnique({ where: { id }, select: { id: true } });
  if (existing || fs.existsSync(path.join(BACKUP_BASE_DIR, id))) {
    throw new AppError(
      "A backup with this name is already in the backup list",
      409,
      "WEBDAV_BACKUP_EXISTS"
    );
  }
}

/**
 * Bring a backup from the share into the backup list.
 *
 * It lands in its own directory (`<base>/<id>/<name>`) because deleting a
 * backup removes the archive's directory — a flat file in the base directory
 * would make that delete take every other backup with it. The row is written
 * only after the download is complete and verified (`downloadFromCloud`
 * throws otherwise and leaves no file); if the row cannot be written the
 * archive is removed again, so a file never exists without its row.
 */
export async function importBackupFromCloud(
  backupName: string,
  onProgress?: (done: number, total: number) => void
): Promise<CloudBackupImportResult> {
  await assertCloudBackupNotPresent(backupName);
  const id = backupIdOfCloudName(backupName);
  const dir = path.join(BACKUP_BASE_DIR, id);
  const localPath = path.join(dir, backupName);

  fs.mkdirSync(dir, { recursive: true });
  try {
    const downloaded = await downloadFromCloud(backupName, localPath, onProgress);
    const now = new Date();
    await prisma.backup.create({
      data: {
        id,
        type: "full",
        status: "completed",
        backupPath: localPath,
        size: BigInt(downloaded.size),
        retentionDays: DEFAULT_RETENTION_DAYS,
        startedAt: now,
        completedAt: now,
        syncedToCloud: true,
        cloudSyncAt: now,
        cloudTarget: downloaded.target,
        cloudPath: downloaded.remotePath,
        metadata: {
          source: "webdav",
          verification: downloaded.verified ? "sha256" : "size",
          sha256: downloaded.sha256,
        },
      },
    });
    logger.info({
      operation: "webdav_backup_imported",
      message: "Backup from the WebDAV share added to the backup list",
      backupId: id,
      verified: downloaded.verified,
    });
    return { backupId: id, verified: downloaded.verified };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
