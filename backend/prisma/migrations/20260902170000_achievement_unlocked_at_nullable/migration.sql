-- `unlocked_at` starts meaning what it says.
--
-- The column was `DateTime NOT NULL DEFAULT now()`, so EVERY user_achievements
-- row carried a date — including the progress-tracking rows the engine creates
-- the moment a measure first moves off zero (`kind: "track"` in
-- utils/achievementWrites.ts). A row sitting at 86 of a required 100 therefore
-- read as "unlocked on <the day tracking began>".
--
-- Measured on the owner's account: 103 rows stood with a date and a progress
-- value BELOW their own requirement, and COUNTRIES_100 carried an earlier date
-- (2026-04-12) than COUNTRIES_50 (2026-08-15) — the harder badge four months
-- before the easier one. Neither was ever displayed as held: every read derives
-- that from `progress >= requirement`, in routes/achievements.ts (list, recent
-- and leaderboard alike) and in `planAchievementWrites`. So nothing on screen
-- was wrong. The COLUMN was, and an audit of the table believed it — which is
-- how two readings of "does revocation happen" came to disagree.
--
-- Dropping the default is as important as dropping NOT NULL: with the default
-- in place a `track` create would keep stamping a date without anyone asking
-- for one, and the lie would simply re-appear on the next new row.
--
-- The backfill nulls exactly the rows every read path already treats as locked.
-- It takes nothing away from anybody: a badge is held when its progress reaches
-- its requirement, before this migration and after it.

ALTER TABLE "user_achievements" ALTER COLUMN "unlocked_at" DROP NOT NULL;
ALTER TABLE "user_achievements" ALTER COLUMN "unlocked_at" DROP DEFAULT;

UPDATE "user_achievements" AS ua
SET "unlocked_at" = NULL
FROM "achievements" AS a
WHERE ua."achievement_id" = a."id"
  AND ua."progress" < a."requirement";
