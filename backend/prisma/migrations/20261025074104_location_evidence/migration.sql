-- AlterTable
ALTER TABLE "dawarich_stay_scans" ADD COLUMN     "provider" TEXT;

-- AlterTable
ALTER TABLE "dawarich_stays" ADD COLUMN     "algorithm_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claim_token" TEXT,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "evidence_key" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'dawarich',
ADD COLUMN     "provider_rev" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "place_visits" ADD COLUMN     "suggestion_ref" TEXT;

-- CreateTable
CREATE TABLE "location_suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_rev" INTEGER NOT NULL,
    "algorithm" INTEGER NOT NULL,
    "evidence_key" TEXT NOT NULL,
    "window_from" TIMESTAMP(3) NOT NULL,
    "window_until" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claim_token" TEXT,
    "claimed_at" TIMESTAMP(3),
    "explanation" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "accepted_entry_kind" TEXT,
    "accepted_entry_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "location_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_dirty_days" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "version" BIGINT NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "travtrack_dirty_days_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateTable
CREATE TABLE "travtrack_derivation_state" (
    "user_id" TEXT NOT NULL,
    "history_generation" BIGINT NOT NULL DEFAULT 0,
    "country_reducer_version" INTEGER NOT NULL DEFAULT 0,
    "stay_algorithm" INTEGER NOT NULL DEFAULT 0,
    "journey_algorithm" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "last_error_kind" TEXT,

    CONSTRAINT "travtrack_derivation_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "travtrack_imports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "status" TEXT NOT NULL,
    "report" JSONB,
    "from_at" TIMESTAMP(3),
    "to_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "travtrack_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_ingest_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "lookup_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "travtrack_ingest_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_suggestions_user_id_status_window_from_idx" ON "location_suggestions"("user_id", "status", "window_from");

-- CreateIndex
CREATE UNIQUE INDEX "location_suggestions_user_id_kind_evidence_key_key" ON "location_suggestions"("user_id", "kind", "evidence_key");

-- CreateIndex
CREATE INDEX "travtrack_imports_user_id_created_at_idx" ON "travtrack_imports"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_ingest_tokens_lookup_hash_key" ON "travtrack_ingest_tokens"("lookup_hash");

-- CreateIndex
CREATE INDEX "travtrack_ingest_tokens_user_id_idx" ON "travtrack_ingest_tokens"("user_id");

-- CreateIndex
CREATE INDEX "dawarich_stays_user_id_provider_status_idx" ON "dawarich_stays"("user_id", "provider", "status");

-- AddForeignKey
ALTER TABLE "location_suggestions" ADD CONSTRAINT "location_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_dirty_days" ADD CONSTRAINT "travtrack_dirty_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_derivation_state" ADD CONSTRAINT "travtrack_derivation_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_imports" ADD CONSTRAINT "travtrack_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_ingest_tokens" ADD CONSTRAINT "travtrack_ingest_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The closed vocabularies, held by the database (hand-appended; Prisma has no enum-less CHECK).
-- Adding the provider columns rewrites no existing row: every Dawarich stay keeps its
-- evidence and fingerprint byte for byte and reads provider 'dawarich', version 0.
ALTER TABLE "dawarich_stays" ADD CONSTRAINT "dawarich_stays_provider_check"
  CHECK ("provider" IN ('dawarich', 'travtrack'));

ALTER TABLE "dawarich_stay_scans" ADD CONSTRAINT "dawarich_stay_scans_provider_check"
  CHECK ("provider" IS NULL OR "provider" IN ('dawarich', 'travtrack'));

ALTER TABLE "location_suggestions" ADD CONSTRAINT "location_suggestions_kind_check"
  CHECK ("kind" IN ('country', 'journey'));

ALTER TABLE "location_suggestions" ADD CONSTRAINT "location_suggestions_provider_check"
  CHECK ("provider" IN ('dawarich', 'travtrack'));

ALTER TABLE "location_suggestions" ADD CONSTRAINT "location_suggestions_status_check"
  CHECK ("status" IN ('pending', 'accepting', 'accepted', 'rejected', 'invalidated'));

ALTER TABLE "location_suggestions" ADD CONSTRAINT "location_suggestions_window_check"
  CHECK ("window_until" > "window_from");

ALTER TABLE "travtrack_imports" ADD CONSTRAINT "travtrack_imports_kind_check"
  CHECK ("kind" IN ('gpx', 'dawarich'));

ALTER TABLE "travtrack_imports" ADD CONSTRAINT "travtrack_imports_status_check"
  CHECK ("status" IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled'));

ALTER TABLE "travtrack_ingest_tokens" ADD CONSTRAINT "travtrack_ingest_tokens_kind_check"
  CHECK ("kind" IN ('owntracks', 'overland'));
