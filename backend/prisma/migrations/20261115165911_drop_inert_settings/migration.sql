/*
  Warnings:

  - You are about to drop the column `auto_update_check_interval` on the `user_settings` table. All the data in the column will be lost.
  - You are about to drop the column `auto_update_only_during_flight` on the `user_settings` table. All the data in the column will be lost.
  - You are about to drop the column `boarding_pass_parser_strategy` on the `user_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "user_settings" DROP COLUMN "auto_update_check_interval",
DROP COLUMN "auto_update_only_during_flight",
DROP COLUMN "boarding_pass_parser_strategy";

-- The same dead preferences also lived in the settings JSON (map.zoomLevel,
-- map.markerStyle, notifications.emailNotifications): saved and returned, read
-- by nothing (forgejo#389). Strip them so a stored blob stops echoing them back.
UPDATE "user_settings"
SET "data" = "data" #- '{map,zoomLevel}' #- '{map,markerStyle}' #- '{notifications,emailNotifications}'
WHERE jsonb_typeof("data") = 'object'
  AND ("data" #> '{map,zoomLevel}' IS NOT NULL
    OR "data" #> '{map,markerStyle}' IS NOT NULL
    OR "data" #> '{notifications,emailNotifications}' IS NOT NULL);
