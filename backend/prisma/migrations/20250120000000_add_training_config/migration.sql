-- AlterTable: Add training configuration fields to AdminSettings
ALTER TABLE "admin_settings" ADD COLUMN IF NOT EXISTS "training_model_output_dir" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN IF NOT EXISTS "training_email_model_name" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN IF NOT EXISTS "training_vision_model_name" TEXT;

-- AlterTable: Add training preferences to UserSettings
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "use_trained_models" BOOLEAN;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "preferred_email_model" TEXT;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "preferred_vision_model" TEXT;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "training_separate_models" BOOLEAN;

-- Set defaults for existing UserSettings (if NULL)
UPDATE "user_settings" SET 
  "use_trained_models" = true 
WHERE "use_trained_models" IS NULL;

UPDATE "user_settings" SET 
  "preferred_email_model" = 'auto' 
WHERE "preferred_email_model" IS NULL;

UPDATE "user_settings" SET 
  "preferred_vision_model" = 'auto' 
WHERE "preferred_vision_model" IS NULL;

UPDATE "user_settings" SET 
  "training_separate_models" = true 
WHERE "training_separate_models" IS NULL;

-- Now set NOT NULL constraint with defaults
ALTER TABLE "user_settings" ALTER COLUMN "use_trained_models" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "use_trained_models" SET DEFAULT true;
ALTER TABLE "user_settings" ALTER COLUMN "preferred_email_model" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "preferred_email_model" SET DEFAULT 'auto';
ALTER TABLE "user_settings" ALTER COLUMN "preferred_vision_model" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "preferred_vision_model" SET DEFAULT 'auto';
ALTER TABLE "user_settings" ALTER COLUMN "training_separate_models" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "training_separate_models" SET DEFAULT true;

-- AlterTable: Add modelType to TrainingJob
ALTER TABLE "training_jobs" ADD COLUMN IF NOT EXISTS "model_type" TEXT;

-- Update existing training jobs to have modelType 'combined' for backward compatibility
UPDATE "training_jobs" SET "model_type" = 'combined' WHERE "model_type" IS NULL;

-- Now set NOT NULL constraint with default
ALTER TABLE "training_jobs" ALTER COLUMN "model_type" SET NOT NULL;
ALTER TABLE "training_jobs" ALTER COLUMN "model_type" SET DEFAULT 'combined';




