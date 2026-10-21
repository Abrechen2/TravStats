-- Hand-edited (forgejo#321): every account that exists today is backfilled to
-- 'expert' so the settings redesign hides nothing it was already using; only
-- rows created afterwards start at 'standard'. Postgres fills existing rows from
-- the ADD COLUMN default, which is why the default is switched in a second step.
-- Replayed by src/__tests__/migration.userSettingsLevel.test.ts.

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "settings_level" TEXT NOT NULL DEFAULT 'expert';

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "settings_level" SET DEFAULT 'standard';
