-- Backfill any NULL / empty rows (defensive; Postgres 11+ should have back-filled during ADD COLUMN)
UPDATE "user_settings"
SET "enabled_domains" = ARRAY['flight']::TEXT[]
WHERE "enabled_domains" IS NULL OR cardinality("enabled_domains") = 0;

-- Tighten the column constraint to match the Prisma schema
ALTER TABLE "user_settings"
ALTER COLUMN "enabled_domains" SET NOT NULL;
