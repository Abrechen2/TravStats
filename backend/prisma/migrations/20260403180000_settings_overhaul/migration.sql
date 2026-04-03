-- Migration: settings_overhaul
-- Adds Ollama + Backup fields to AdminSettings, drops dead fields

-- Drop system_settings table (replaced by AdminSettings)
DROP TABLE IF EXISTS "system_settings";

-- Add Ollama configuration columns to admin_settings
ALTER TABLE "admin_settings" ADD COLUMN "ollama_url" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "ollama_model" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "ollama_vision_model" TEXT;

-- Add Backup schedule columns to admin_settings
ALTER TABLE "admin_settings" ADD COLUMN "backup_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "admin_settings" ADD COLUMN "backup_interval" TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE "admin_settings" ADD COLUMN "backup_retention_days" INTEGER NOT NULL DEFAULT 30;

-- Remove dead columns from admin_settings
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "require_user_api_keys";
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "require_user_flight_api_keys";
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "debug_logging_enabled";

-- Remove dead column from user_settings
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "training_separate_models";
