-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "debug_logging_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "log_database_queries" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "log_http_requests" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "log_level" TEXT NOT NULL DEFAULT 'info',
ADD COLUMN     "log_parser_operations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "log_retention_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "max_log_file_size" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "max_log_files" INTEGER NOT NULL DEFAULT 7;
