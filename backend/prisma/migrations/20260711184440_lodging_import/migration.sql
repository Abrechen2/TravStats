-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "batch_id" TEXT,
ADD COLUMN     "external_ref" TEXT;

-- AlterTable
ALTER TABLE "lodgings" ADD COLUMN     "batch_id" TEXT,
ADD COLUMN     "external_ref" TEXT;

-- CreateTable
CREATE TABLE "lodging_import_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lodging_import_batches_user_id_idx" ON "lodging_import_batches"("user_id");

-- CreateIndex
CREATE INDEX "lodging_stays_batch_id_idx" ON "lodging_stays"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "lodging_stays_user_id_external_ref_key" ON "lodging_stays"("user_id", "external_ref");

-- CreateIndex
CREATE INDEX "lodgings_batch_id_idx" ON "lodgings"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "lodgings_user_id_external_ref_key" ON "lodgings"("user_id", "external_ref");

-- AddForeignKey
ALTER TABLE "lodgings" ADD CONSTRAINT "lodgings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lodging_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lodging_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_import_batches" ADD CONSTRAINT "lodging_import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
