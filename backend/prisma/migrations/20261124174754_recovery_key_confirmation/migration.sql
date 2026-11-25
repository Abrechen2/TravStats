-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "recovery_key_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "recovery_key_fingerprint" TEXT;
