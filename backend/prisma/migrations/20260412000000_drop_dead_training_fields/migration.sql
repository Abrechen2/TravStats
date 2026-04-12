-- Drop dead LLM training fields from user_settings
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "use_trained_models";
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "preferred_email_model";
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "preferred_vision_model";

-- Drop dead training config fields from admin_settings
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "training_model_output_dir";
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "training_email_model_name";
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "training_vision_model_name";
