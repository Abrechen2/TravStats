-- Invitation links carry the inviter's switches (spec 2026-11-08 §11.8). All nullable: a link or a
-- code from before has none and is redeemed leaderboard-only.

-- AlterTable
ALTER TABLE "federation_admission_requests" ADD COLUMN     "switches" JSONB;

-- AlterTable
ALTER TABLE "leaderboard_invites" ADD COLUMN     "switches" JSONB;

-- AlterTable
ALTER TABLE "leaderboard_remotes" ADD COLUMN     "invite_switches" JSONB;
