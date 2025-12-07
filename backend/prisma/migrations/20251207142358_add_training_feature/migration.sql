-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "developer_mode_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "developer_mode_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "can_train_llm" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "training_data" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "original_file" TEXT NOT NULL,
    "annotations" JSONB NOT NULL,
    "extractedData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trained_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "training_data_ids" TEXT[],
    "model_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "log_file" TEXT,
    "metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_logs" (
    "id" TEXT NOT NULL,
    "training_job_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_data_user_id_idx" ON "training_data"("user_id");

-- CreateIndex
CREATE INDEX "training_data_status_idx" ON "training_data"("status");

-- CreateIndex
CREATE INDEX "training_jobs_status_idx" ON "training_jobs"("status");

-- CreateIndex
CREATE INDEX "training_logs_training_job_id_idx" ON "training_logs"("training_job_id");

-- CreateIndex
CREATE INDEX "training_logs_timestamp_idx" ON "training_logs"("timestamp");

-- AddForeignKey
ALTER TABLE "training_data" ADD CONSTRAINT "training_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_logs" ADD CONSTRAINT "training_logs_training_job_id_fkey" FOREIGN KEY ("training_job_id") REFERENCES "training_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
