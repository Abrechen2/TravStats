-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletion_prior_active" BOOLEAN,
ADD COLUMN     "deletion_prior_admin" BOOLEAN,
ADD COLUMN     "deletion_started_at" TIMESTAMP(3);
