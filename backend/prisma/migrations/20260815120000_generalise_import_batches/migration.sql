-- Generalises the import batch from "lodging only" to every domain.
--
-- HAND-WRITTEN ON PURPOSE. `prisma migrate dev` cannot see a rename: it emits
-- DROP TABLE "lodging_import_batches" + CREATE TABLE "import_batches", which
-- would destroy every import batch already recorded on prod and leave every
-- `batch_id` on lodgings and stays pointing at nothing — "undo this import"
-- silently dead for everything imported so far. So the table is RENAMED and
-- its rows keep their identity; only the new `domain` column is added, filled
-- with 'lodging' because that is what every existing batch is.

ALTER TABLE "lodging_import_batches" RENAME TO "import_batches";
ALTER TABLE "import_batches" RENAME CONSTRAINT "lodging_import_batches_pkey" TO "import_batches_pkey";
ALTER TABLE "import_batches" RENAME CONSTRAINT "lodging_import_batches_user_id_fkey" TO "import_batches_user_id_fkey";
ALTER INDEX "lodging_import_batches_user_id_idx" RENAME TO "import_batches_user_id_idx";

ALTER TABLE "import_batches" ADD COLUMN "domain" TEXT;
UPDATE "import_batches" SET "domain" = 'lodging' WHERE "domain" IS NULL;
ALTER TABLE "import_batches" ALTER COLUMN "domain" SET NOT NULL;

CREATE INDEX "import_batches_user_id_domain_idx" ON "import_batches"("user_id", "domain");

-- Provenance + batch link for the two domains that had neither.
ALTER TABLE "flights" ADD COLUMN "external_ref" TEXT,
                      ADD COLUMN "import_batch_id" TEXT;
ALTER TABLE "cruises" ADD COLUMN "external_ref" TEXT,
                      ADD COLUMN "import_batch_id" TEXT;

CREATE INDEX "flights_import_batch_id_idx" ON "flights"("import_batch_id");
CREATE INDEX "cruises_import_batch_id_idx" ON "cruises"("import_batch_id");

-- Postgres treats NULLs as distinct, so every row that has no provenance yet
-- (all of them, today) stays unaffected by this constraint.
CREATE UNIQUE INDEX "flights_user_id_external_ref_key" ON "flights"("user_id", "external_ref");
CREATE UNIQUE INDEX "cruises_user_id_external_ref_key" ON "cruises"("user_id", "external_ref");

ALTER TABLE "flights" ADD CONSTRAINT "flights_import_batch_id_fkey"
  FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_import_batch_id_fkey"
  FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
