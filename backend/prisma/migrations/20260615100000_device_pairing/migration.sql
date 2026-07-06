-- Device pairing (mobile app) — Phase S.1
--
-- Hand-written (not `prisma migrate dev`-generated) on purpose: the existing
-- schema has pre-existing drift vs. the migration history (see CLAUDE.md),
-- which `prisma migrate dev` would bundle into any new migration and break
-- prod on deploy. Every statement here is additive and idempotent
-- (IF NOT EXISTS) — no drops, no unrelated changes.

-- Device-pairing metadata on existing PATs.
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "device_id" TEXT;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "app_version" TEXT;

-- Composite index for the (userId, deviceId) re-pair revoke lookup.
CREATE INDEX IF NOT EXISTS "api_tokens_user_id_device_id_idx"
  ON "api_tokens"("user_id", "device_id");

-- One-time pairing codes.
CREATE TABLE IF NOT EXISTS "pairing_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pairing_codes_code_hash_key"
  ON "pairing_codes"("code_hash");

CREATE INDEX IF NOT EXISTS "pairing_codes_user_id_idx"
  ON "pairing_codes"("user_id");

-- Foreign key. Guarded so re-applying the idempotent migration doesn't error
-- on the already-present constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pairing_codes_user_id_fkey'
  ) THEN
    ALTER TABLE "pairing_codes"
      ADD CONSTRAINT "pairing_codes_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
