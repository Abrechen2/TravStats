-- Trip-system redesign foundation (Phase 1, Iteration 1).
-- Promotes Trip from "name+desc+color" label to a first-class
-- multi-domain travel artifact with own dates, status, category,
-- tags, companions, notes, location, cover image and country list.
-- All additions are nullable / defaulted so legacy rows remain valid.
-- Hand-written like other recent migrations to dodge the pre-existing
-- schema-drift in the migration history (see CLAUDE.md).

ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "start_date"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "end_date"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status"            TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS "category"          TEXT,
  ADD COLUMN IF NOT EXISTS "tags"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "companions"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "notes"             TEXT,
  ADD COLUMN IF NOT EXISTS "summary"           TEXT,
  ADD COLUMN IF NOT EXISTS "origin_label"      TEXT,
  ADD COLUMN IF NOT EXISTS "destination_label" TEXT,
  ADD COLUMN IF NOT EXISTS "cover_image_url"   TEXT,
  ADD COLUMN IF NOT EXISTS "icon"              TEXT,
  ADD COLUMN IF NOT EXISTS "countries"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Helps "by status" filter on the list view.
CREATE INDEX IF NOT EXISTS "trips_user_id_status_idx" ON "trips"("user_id", "status");
