-- Friends, one connection (spec 2026-11-08 §11.3, §11.7): every pairing that exists today becomes
-- one connection WITHOUT sharing more than it did. Only GRANTED rows count: an accepted
-- share_consents row, an accepted leaderboard_consents row, an active plan member whose two
-- consents still hold. Pending, declined, withdrawn, invited, left and revoked rows grant nothing.
-- Every switch no old row granted stays off. Old rows are left exactly as they are
-- (leaderboard_consents keeps the comparison scope behind the switch verbatim).
-- Replayed against old-shape rows by src/__tests__/migration.friendsOneConnection.test.ts.

-- Local pairs. Direction is the grant's direction: an accepted share consent requester -> target
-- means the TARGET lets the requester offer trips, so it sets the target's tripOffers switch.
-- An accepted leaderboard consent sets its OWNER's leaderboard switch. A plan both consents still
-- hold for sets plans on both sides (the plan needs both).
INSERT INTO "local_connections"
  ("id", "user_low_id", "user_high_id", "state", "requested_by", "low_switches", "high_switches",
   "requested_at", "confirmed_at")
WITH grants AS (
  SELECT "target_id" AS grantor, "requester_id" AS grantee, 'tripOffers' AS sw
    FROM "share_consents"
   WHERE "status" = 'accepted' AND "requester_id" IS NOT NULL AND "target_id" IS NOT NULL
  UNION ALL
  SELECT "owner_id", "viewer_id", 'leaderboard'
    FROM "leaderboard_consents"
   WHERE "status" = 'accepted' AND "viewer_id" IS NOT NULL
  UNION ALL
  SELECT p.who, p.other, 'plans'
    FROM (
      SELECT t."user_id" AS who, m."user_id" AS other
        FROM "travel_plan_members" m
        JOIN "travel_plans" tp ON tp."id" = m."plan_id"
        JOIN "trips" t ON t."id" = tp."trip_id"
       WHERE m."kind" = 'local' AND m."status" = 'active' AND m."user_id" IS NOT NULL
         AND EXISTS (SELECT 1 FROM "share_consents" c WHERE c."status" = 'accepted'
                      AND c."requester_id" = t."user_id" AND c."target_id" = m."user_id")
         AND EXISTS (SELECT 1 FROM "share_consents" c WHERE c."status" = 'accepted'
                      AND c."requester_id" = m."user_id" AND c."target_id" = t."user_id")
      UNION
      SELECT m."user_id", t."user_id"
        FROM "travel_plan_members" m
        JOIN "travel_plans" tp ON tp."id" = m."plan_id"
        JOIN "trips" t ON t."id" = tp."trip_id"
       WHERE m."kind" = 'local' AND m."status" = 'active' AND m."user_id" IS NOT NULL
         AND EXISTS (SELECT 1 FROM "share_consents" c WHERE c."status" = 'accepted'
                      AND c."requester_id" = t."user_id" AND c."target_id" = m."user_id")
         AND EXISTS (SELECT 1 FROM "share_consents" c WHERE c."status" = 'accepted'
                      AND c."requester_id" = m."user_id" AND c."target_id" = t."user_id")
    ) p
), pairs AS (
  SELECT LEAST(grantor COLLATE "C", grantee COLLATE "C") AS low,
         GREATEST(grantor COLLATE "C", grantee COLLATE "C") AS high,
         grantor, sw
    FROM grants
   WHERE grantor <> grantee
)
SELECT gen_random_uuid()::text, low, high, 'active', low,
       jsonb_build_object(
         'plans', COALESCE(bool_or(grantor = low AND sw = 'plans'), false),
         'stats', 'off',
         'achievements', false,
         'leaderboard', COALESCE(bool_or(grantor = low AND sw = 'leaderboard'), false),
         'tripOffers', COALESCE(bool_or(grantor = low AND sw = 'tripOffers'), false)),
       jsonb_build_object(
         'plans', COALESCE(bool_or(grantor = high AND sw = 'plans'), false),
         'stats', 'off',
         'achievements', false,
         'leaderboard', COALESCE(bool_or(grantor = high AND sw = 'leaderboard'), false),
         'tripOffers', COALESCE(bool_or(grantor = high AND sw = 'tripOffers'), false)),
       now(), now()
  FROM pairs
 GROUP BY low, high
ON CONFLICT DO NOTHING;

-- Remote, already one person: a pairing linked through leaderboard_remote_id is the verified
-- channel binding. It keeps its id, plans and scope; its leaderboard switch now reflects the
-- consent that was already granted (never turned off, nothing else touched).
UPDATE "remote_share_accounts" a
   SET "share_leaderboard" = true
 WHERE a."leaderboard_remote_id" IS NOT NULL
   AND a."share_leaderboard" = false
   AND EXISTS (SELECT 1 FROM "leaderboard_consents" c
                WHERE c."owner_id" = a."user_id" AND c."remote_id" = a."leaderboard_remote_id"
                  AND c."status" = 'accepted');

-- Remote, no binding: a leaderboard friend that is still live (a yes or a question) becomes its
-- own connection in `reconfirm` carrying only the leaderboard switch the old consent granted. The
-- two share channels are unknown until the person confirms again, so random placeholders keep the
-- row unique (as a first request does). Never merged with another row by name.
INSERT INTO "remote_share_accounts"
  ("id", "user_id", "origin", "channel", "local_channel", "username", "display_name",
   "leaderboard_remote_id", "state", "share_leaderboard", "created_at")
SELECT gen_random_uuid()::text, r."user_id", r."origin", gen_random_uuid()::text,
       gen_random_uuid()::text, r."username", r."display_name", r."id", 'reconfirm',
       EXISTS (SELECT 1 FROM "leaderboard_consents" c
                WHERE c."owner_id" = r."user_id" AND c."remote_id" = r."id"
                  AND c."status" = 'accepted'),
       now()
  FROM "leaderboard_remotes" r
 WHERE NOT EXISTS (SELECT 1 FROM "remote_share_accounts" a WHERE a."leaderboard_remote_id" = r."id")
   AND EXISTS (SELECT 1 FROM "leaderboard_consents" c
                WHERE c."owner_id" = r."user_id" AND c."remote_id" = r."id"
                  AND c."status" IN ('accepted', 'pending'));
