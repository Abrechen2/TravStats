-- Anonymous usage statistics: instance-wide opt-in consent + random install id.
-- Hand-written (not `prisma migrate dev`) to avoid bundling pre-existing
-- schema drift into this migration. See CLAUDE.md, "Cruise migrations".

ALTER TABLE "admin_settings"
  ADD COLUMN "usage_stats_consent" TEXT NOT NULL DEFAULT 'unset',
  ADD COLUMN "usage_stats_install_id" TEXT;
