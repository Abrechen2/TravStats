-- AddColumn for email tracking
ALTER TABLE "invitations" ADD COLUMN "email_status" TEXT;
ALTER TABLE "invitations" ADD COLUMN "email_error" TEXT;
ALTER TABLE "invitations" ADD COLUMN "email_sent_at" TIMESTAMP(3);

-- DropForeignKey (the old one was created by Prisma without explicit relation name)
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_used_by_fkey";

-- AddForeignKey with proper constraint name and ON DELETE SET NULL
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_fkey"
  FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
