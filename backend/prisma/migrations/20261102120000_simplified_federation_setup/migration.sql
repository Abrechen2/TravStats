-- Simplified federation setup (owner direction 2026-10-26, forgejo#301): server-level trust,
-- an opt-in to being found by connected servers (default off), and per remote person a
-- statistics level (off | overview | full, default off) plus the leaderboard pairing made with it.

-- AlterTable
ALTER TABLE "remote_share_accounts" ADD COLUMN     "leaderboard_remote_id" TEXT,
ADD COLUMN     "stats_level" TEXT NOT NULL DEFAULT 'off';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "federation_findable" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "remote_share_accounts_leaderboard_remote_id_key" ON "remote_share_accounts"("leaderboard_remote_id");

-- AddForeignKey
ALTER TABLE "remote_share_accounts" ADD CONSTRAINT "remote_share_accounts_leaderboard_remote_id_fkey" FOREIGN KEY ("leaderboard_remote_id") REFERENCES "leaderboard_remotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added, as in share_vocabulary_checks: the vocabulary is closed in the database too.
ALTER TABLE "remote_share_accounts" ADD CONSTRAINT "remote_share_accounts_stats_level_check" CHECK ("stats_level" IN ('off', 'overview', 'full'));
