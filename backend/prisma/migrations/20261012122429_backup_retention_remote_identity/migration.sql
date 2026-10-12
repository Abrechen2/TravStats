-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "backup_cloud_retention" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "backups" ADD COLUMN     "cloud_delete_error" TEXT,
ADD COLUMN     "cloud_path" TEXT,
ADD COLUMN     "cloud_target" TEXT;
