-- CreateTable
CREATE TABLE "leaderboard_consents" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "viewer_id" TEXT,
    "remote_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scope" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "leaderboard_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_remotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_remotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_invites" (
    "hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "leaderboard_invites_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "leaderboard_boards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_board_members" (
    "id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "consent_id" TEXT,
    "remote_id" TEXT,

    CONSTRAINT "leaderboard_board_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leaderboard_consents_viewer_id_status_idx" ON "leaderboard_consents"("viewer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_consents_owner_id_viewer_id_key" ON "leaderboard_consents"("owner_id", "viewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_consents_owner_id_remote_id_key" ON "leaderboard_consents"("owner_id", "remote_id");

-- CreateIndex
CREATE INDEX "leaderboard_remotes_user_id_idx" ON "leaderboard_remotes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_remotes_origin_channel_key" ON "leaderboard_remotes"("origin", "channel");

-- CreateIndex
CREATE INDEX "leaderboard_invites_user_id_idx" ON "leaderboard_invites"("user_id");

-- CreateIndex
CREATE INDEX "leaderboard_boards_user_id_idx" ON "leaderboard_boards"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_board_members_board_id_consent_id_key" ON "leaderboard_board_members"("board_id", "consent_id");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_board_members_board_id_remote_id_key" ON "leaderboard_board_members"("board_id", "remote_id");

-- AddForeignKey
ALTER TABLE "leaderboard_consents" ADD CONSTRAINT "leaderboard_consents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_consents" ADD CONSTRAINT "leaderboard_consents_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_consents" ADD CONSTRAINT "leaderboard_consents_remote_id_fkey" FOREIGN KEY ("remote_id") REFERENCES "leaderboard_remotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_remotes" ADD CONSTRAINT "leaderboard_remotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_invites" ADD CONSTRAINT "leaderboard_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_boards" ADD CONSTRAINT "leaderboard_boards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_board_members" ADD CONSTRAINT "leaderboard_board_members_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "leaderboard_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_board_members" ADD CONSTRAINT "leaderboard_board_members_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "leaderboard_consents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_board_members" ADD CONSTRAINT "leaderboard_board_members_remote_id_fkey" FOREIGN KEY ("remote_id") REFERENCES "leaderboard_remotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express these; check:drift does not compare CHECK constraints.
ALTER TABLE "leaderboard_consents"
  ADD CONSTRAINT "leaderboard_consents_one_viewer" CHECK (("viewer_id" IS NULL) <> ("remote_id" IS NULL));
ALTER TABLE "leaderboard_consents"
  ADD CONSTRAINT "leaderboard_consents_status" CHECK ("status" IN ('pending', 'accepted', 'declined', 'withdrawn'));
ALTER TABLE "leaderboard_board_members"
  ADD CONSTRAINT "leaderboard_board_members_one_member" CHECK (("consent_id" IS NULL) <> ("remote_id" IS NULL));

-- Existing beta data (spec 7.3). A LOCAL friendship whose granter shared statistics directly
-- (audience '') becomes "granter's totals may be seen by the friend". Costs, trips, precision
-- and expiry have no counterpart in the new scope and are not carried. Remote friendships,
-- group grants and grants without statistics are NOT copied: their users ask again. The E2E
-- tables themselves stay untouched.
-- The old scope allowed duplicate and unknown domains and an absent list; the new scope
-- (leaderboardScopeSchema) allows 1..9 distinct known ones. So domains are de-duplicated,
-- filtered to the known keys, and an empty result falls back to every domain (an old grant
-- with no domain list restricted nothing). A grant whose year is not null or an integer in
-- 1900..2200 is not copied rather than widened to "every year".
-- BEGIN LEADERBOARD DATA COPY
DO $$
DECLARE copied integer;
BEGIN
  INSERT INTO "leaderboard_consents" ("id", "owner_id", "viewer_id", "status", "scope", "created_at", "decided_at")
  SELECT gen_random_uuid()::text, l."user_id", c."user_id", 'accepted',
         jsonb_build_object(
           'groups', '["distance","trips","time","places"]'::jsonb,
           'domains', COALESCE(
             (SELECT jsonb_agg(DISTINCT d)
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(g."scope"->'domains') = 'array'
                       THEN g."scope"->'domains' ELSE '[]'::jsonb END) d
               WHERE d IN ('"flight"', '"cruise"', '"lodging"', '"poi"', '"roadtrip"',
                           '"rail"', '"rental"', '"bus"', '"ferry"')),
             '["flight","cruise","lodging","poi","roadtrip","rail","rental","bus","ferry"]'::jsonb),
           'year', COALESCE(g."scope"->'year', 'null'::jsonb)),
         NOW(), NOW()
  FROM "comparison_links" l
  JOIN "comparison_links" c
    ON c."channel" = l."channel" AND c."id" <> l."id" AND c."origin" = 'local' AND NOT c."revoked"
  JOIN "comparison_grants" g ON g."link_id" = l."id" AND g."audience" = ''
  JOIN "users" ou ON ou."id" = l."user_id" AND ou."is_active"
  WHERE l."origin" = 'local'
    AND l."confirmed" AND l."remote_confirmed" AND NOT l."revoked"
    AND l."user_id" <> c."user_id"
    AND g."active" AND (g."expires_at" IS NULL OR g."expires_at" > NOW())
    AND g."scope"->'statistics' = 'true'::jsonb
    AND (jsonb_typeof(g."scope"->'year') IS NULL
         OR jsonb_typeof(g."scope"->'year') = 'null'
         OR (jsonb_typeof(g."scope"->'year') = 'number'
             AND (g."scope"->>'year') ~ '^(19|20|21)[0-9]{2}$'
             AND (g."scope"->>'year')::int BETWEEN 1900 AND 2200))
  ON CONFLICT ("owner_id", "viewer_id") DO NOTHING;
  GET DIAGNOSTICS copied = ROW_COUNT;
  RAISE NOTICE 'leaderboard: % consents copied from comparison grants', copied;
END $$;
-- END LEADERBOARD DATA COPY
