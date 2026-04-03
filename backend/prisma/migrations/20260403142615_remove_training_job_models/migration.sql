-- DropForeignKey
ALTER TABLE "training_logs" DROP CONSTRAINT IF EXISTS "training_logs_training_job_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "training_jobs_status_idx";

-- DropIndex
DROP INDEX IF EXISTS "training_logs_training_job_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "training_logs_timestamp_idx";

-- DropTable
DROP TABLE IF EXISTS "training_logs";

-- DropTable
DROP TABLE IF EXISTS "training_jobs";
