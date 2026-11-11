-- Settings v3 S6: the granular outbound switches fold into the master switch
-- "internet_enabled". An admin who had switched ALL five of them off wanted an
-- install that talks to nobody: carry that over before the columns go. A partly
-- switched set cannot be expressed by one switch and falls to the default (on).
UPDATE "admin_settings"
SET "internet_enabled" = false
WHERE "fx_cdn_fallback_enabled" = false
  AND "operator_logos_open_data_enabled" = false
  AND "rail_transitous_enabled" = false
  AND "rail_db_rest_enabled" = false
  AND "update_check_enabled" = false;

-- AlterTable
ALTER TABLE "admin_settings" DROP COLUMN "backup_enabled",
DROP COLUMN "fx_cdn_fallback_enabled",
DROP COLUMN "log_database_queries",
DROP COLUMN "log_http_requests",
DROP COLUMN "log_parser_operations",
DROP COLUMN "max_log_file_size",
DROP COLUMN "max_log_files",
DROP COLUMN "operator_logos_open_data_enabled",
DROP COLUMN "rail_db_rest_enabled",
DROP COLUMN "rail_transitous_enabled",
DROP COLUMN "update_check_enabled";

