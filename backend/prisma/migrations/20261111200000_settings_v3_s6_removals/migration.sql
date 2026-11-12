-- Settings v3 S6: switches that became fixed defaults leave the table. The five
-- granular outbound switches (fx_cdn_fallback_enabled, operator_logos_open_data_enabled,
-- rail_transitous_enabled, rail_db_rest_enabled, update_check_enabled) STAY: the
-- owner put them back as expert rows on 2026-11-12, so their values carry over as
-- they are and "internet_enabled" is not derived from them.

-- AlterTable
ALTER TABLE "admin_settings" DROP COLUMN "backup_enabled",
DROP COLUMN "log_database_queries",
DROP COLUMN "log_http_requests",
DROP COLUMN "log_parser_operations",
DROP COLUMN "max_log_file_size",
DROP COLUMN "max_log_files";
