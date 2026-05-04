-- Mark seeded demo users (e.g. local dev `admin:admin123`) so the backend
-- can refuse quota-burning admin actions like bulk AeroDataBox refresh
-- against demo accounts. Real prod users default to `is_demo = false`.
-- Hand-written like the cruise/aircraft-provenance migrations to dodge
-- the pre-existing schema-drift in the migration history (see CLAUDE.md).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_demo" BOOLEAN NOT NULL DEFAULT false;
