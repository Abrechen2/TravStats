-- Hand-written data migration (tours-own-domain, T1): `tour` joined the domain
-- registry. An account that already has a tour must not lose sight of it, so
-- every such account gets `tour` in its enabled domains.
--
-- Two cases: (1) the account has a user_settings row -> `tour` is appended;
-- (2) it has none (never loaded its settings since rows existed) -> the row is
-- created, because `domainVisibility.ts` reads a missing row as "flights only"
-- and the tours would stay hidden. A created row carries the schema default
-- (`{flight}`) plus `tour`, and an empty blob: the settings route merges
-- `defaultSettings` under what is stored, as it does for any stored blob.
--
-- Idempotent: a second run appends nothing and creates nothing. No schema
-- change, so `check:drift` is unaffected. Replayed by
-- src/__tests__/migration.tourDomainBackfill.test.ts.
INSERT INTO "user_settings" ("id", "user_id", "enabled_domains", "data", "updated_at")
SELECT gen_random_uuid()::text, r."user_id", ARRAY['flight', 'tour'], '{}'::jsonb, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "user_id" FROM "trip_routes" WHERE "kind" = 'tour') r
WHERE NOT EXISTS (SELECT 1 FROM "user_settings" s WHERE s."user_id" = r."user_id");

UPDATE "user_settings" s
SET "enabled_domains" = array_append(s."enabled_domains", 'tour')
WHERE NOT ('tour' = ANY (s."enabled_domains"))
  AND EXISTS (SELECT 1 FROM "trip_routes" t WHERE t."user_id" = s."user_id" AND t."kind" = 'tour');
