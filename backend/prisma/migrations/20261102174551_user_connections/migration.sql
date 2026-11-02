-- AlterTable
ALTER TABLE "remote_share_accounts" ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "ended_by_me" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "peer_generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "peer_leaderboard_channel" TEXT,
ADD COLUMN     "remote_switches" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "requested_at" TIMESTAMP(3),
ADD COLUMN     "share_achievements" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "share_leaderboard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "share_plans" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "share_trip_offers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'active';

-- Pairings made before the connection model keep the trips already shared with them, but nothing
-- new starts on them until both sides confirm once (spec 2026-11-02 §2). What they showed ends.
UPDATE "remote_share_accounts" SET "state" = 'reconfirm', "stats_level" = 'off';
UPDATE "leaderboard_consents" SET "status" = 'withdrawn', "decided_at" = now()
  WHERE "status" = 'accepted' AND "remote_id" IN (
    SELECT "leaderboard_remote_id" FROM "remote_share_accounts" WHERE "leaderboard_remote_id" IS NOT NULL);

ALTER TABLE "remote_share_accounts" ADD CONSTRAINT "remote_share_accounts_state_check"
  CHECK ("state" IN ('pending_out', 'pending_in', 'active', 'declined', 'revoked', 'reconfirm'));
