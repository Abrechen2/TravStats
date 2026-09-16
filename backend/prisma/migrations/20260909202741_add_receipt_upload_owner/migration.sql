-- CreateTable
CREATE TABLE "receipt_uploads" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_uploads_filename_key" ON "receipt_uploads"("filename");

-- CreateIndex
CREATE INDEX "receipt_uploads_user_id_idx" ON "receipt_uploads"("user_id");

-- AddForeignKey
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every receipt an existing record points at gets its owner recorded.
--
-- Without this, the ownership check below would find no row for any file
-- uploaded before this migration and refuse every existing receipt. The owner
-- is taken from the record that references the file, which is the best evidence
-- available and is exactly what the old check used at read time.
--
-- DISTINCT ON with ORDER BY picks the earliest reference when several exist. A
-- file referenced by two DIFFERENT accounts is only possible because of the bug
-- this migration closes; the earliest reference is the upload, the later one is
-- somebody who typed the URL.
--
-- The id is derived from the filename rather than generated, so this statement
-- needs no uuid function and is safe to re-run.
INSERT INTO "receipt_uploads" ("id", "filename", "user_id", "created_at")
SELECT DISTINCT ON ("filename")
       md5('receipt-upload:' || "filename"),
       "filename",
       "user_id",
       "created_at"
FROM (
  SELECT split_part("receipt_url", '/', 6) AS "filename", "user_id", "created_at"
    FROM "flights" WHERE "receipt_url" IS NOT NULL
  UNION ALL
  SELECT split_part("receipt_url", '/', 6), "user_id", "created_at"
    FROM "lodging_stays" WHERE "receipt_url" IS NOT NULL
) AS "refs"
WHERE "filename" <> ''
ORDER BY "filename", "created_at"
ON CONFLICT ("filename") DO NOTHING;
