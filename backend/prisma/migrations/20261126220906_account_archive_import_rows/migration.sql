-- CreateTable
CREATE TABLE "account_archive_import_rows" (
    "id" BIGSERIAL NOT NULL,
    "archive_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_key" TEXT NOT NULL,

    CONSTRAINT "account_archive_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_archive_import_rows_archive_id_table_name_idx" ON "account_archive_import_rows"("archive_id", "table_name");

-- AddForeignKey
ALTER TABLE "account_archive_import_rows" ADD CONSTRAINT "account_archive_import_rows_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "account_archive_imports"("archive_id") ON DELETE CASCADE ON UPDATE CASCADE;
