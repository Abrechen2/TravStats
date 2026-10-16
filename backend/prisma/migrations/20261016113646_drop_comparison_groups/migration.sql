-- Comparison boards (forgejo#40) had no UI and no reader: GET/POST /comparison/boards were never
-- called by the frontend. Their rows are dropped with the table; nobody can have seen them.
-- Leaderboard groups are LeaderboardBoard (comparison rework 2026-10-16).
/*
  Warnings:

  - You are about to drop the `comparison_groups` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "comparison_groups" DROP CONSTRAINT "comparison_groups_user_id_fkey";

-- DropTable
DROP TABLE "comparison_groups";
