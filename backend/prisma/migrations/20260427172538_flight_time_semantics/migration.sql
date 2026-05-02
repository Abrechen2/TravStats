-- Add per-flight time-storage semantics so the canonical real-UTC convention
-- can coexist with legacy wall-clock-as-fake-UTC rows during the cutover.
--
-- Values:
--   'UTC'             — canonical real UTC instant (going forward)
--   'LEGACY_FAKE_UTC' — wall-clock encoded as fake-UTC; needs the airport
--                       timezone to be interpreted as a real instant
--   'UNKNOWN'         — not yet classified by the backfill script
--
-- Idempotent so re-running on a partially-migrated DB is safe.

ALTER TABLE "flights"
  ADD COLUMN IF NOT EXISTS "dep_time_semantics" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "arr_time_semantics" TEXT NOT NULL DEFAULT 'UNKNOWN';
