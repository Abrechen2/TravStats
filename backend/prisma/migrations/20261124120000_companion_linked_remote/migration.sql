-- AlterTable
ALTER TABLE "companions" ADD COLUMN     "linked_remote_id" TEXT,
ADD COLUMN     "not_same_as" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "companions_linked_remote_id_idx" ON "companions"("linked_remote_id");

-- CreateIndex
CREATE UNIQUE INDEX "companions_user_id_linked_remote_id_key" ON "companions"("user_id", "linked_remote_id");

-- AddForeignKey
ALTER TABLE "companions" ADD CONSTRAINT "companions_linked_remote_id_fkey" FOREIGN KEY ("linked_remote_id") REFERENCES "remote_share_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

