-- CreateTable
CREATE TABLE "account_archive_imports" (
    "id" TEXT NOT NULL,
    "archive_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_server_version" TEXT NOT NULL,
    "format_version" INTEGER NOT NULL,
    "counts" JSONB NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_archive_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_archive_imports_archive_id_key" ON "account_archive_imports"("archive_id");

-- CreateIndex
CREATE INDEX "account_archive_imports_user_id_idx" ON "account_archive_imports"("user_id");

-- AddForeignKey
ALTER TABLE "account_archive_imports" ADD CONSTRAINT "account_archive_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
