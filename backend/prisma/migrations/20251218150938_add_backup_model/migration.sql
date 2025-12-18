-- CreateTable
CREATE TABLE "backups" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'full',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "backup_path" TEXT NOT NULL,
    "db_backup_path" TEXT,
    "files_backup_path" TEXT,
    "size" BIGINT NOT NULL DEFAULT 0,
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "metadata" JSONB,
    "synced_to_cloud" BOOLEAN NOT NULL DEFAULT false,
    "cloud_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backups_status_idx" ON "backups"("status");

-- CreateIndex
CREATE INDEX "backups_type_idx" ON "backups"("type");

-- CreateIndex
CREATE INDEX "backups_created_at_idx" ON "backups"("created_at");
