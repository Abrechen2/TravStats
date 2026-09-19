-- `documents.unlinked_at` — since WHEN a document has belonged to nothing.
--
-- The hourly sweep counted the TTL from `created_at`, which is the age of the
-- FILE and not the age of the problem. Unfiling a document uploaded two months
-- ago therefore put it past the TTL the instant it was unfiled, and the next
-- pass deleted it — while the inbox, reading the same `created_at`, had just
-- shown the user a deletion date in the past. Whatever the TTL is, it is owed
-- from the moment the document became unfiled.
--
-- Null exactly when the document IS filed, which is what the partial backfill
-- below establishes: every existing unfiled row is dated `created_at`, because
-- that is the only evidence this database has of when it became unfiled, and
-- it is the reading that matches the behaviour those rows have had until now.
-- Filed rows stay null.

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "unlinked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "documents_unlinked_at_idx" ON "documents"("unlinked_at");

-- Backfill: the five owner columns all null is exactly `NO_OWNER` in
-- `services/documents/documentService.ts`.
UPDATE "documents"
SET "unlinked_at" = "created_at"
WHERE "flight_id" IS NULL
  AND "cruise_id" IS NULL
  AND "lodging_stay_id" IS NULL
  AND "trip_id" IS NULL
  AND "place_visit_id" IS NULL;
