-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "external_service_policy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "update_check_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "external_service_prefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "external_service_tests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "service_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "external_service_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_service_tests_user_id_service_id_idx" ON "external_service_tests"("user_id", "service_id");

-- AddForeignKey
ALTER TABLE "external_service_tests" ADD CONSTRAINT "external_service_tests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
