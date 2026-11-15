-- AlterTable
ALTER TABLE "users" ADD COLUMN     "readiness_invitation_seen" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "readiness_invitation_snoozed_until" TIMESTAMP(3);
