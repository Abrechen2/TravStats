-- Add boarding_pass_parser_strategy to user_settings
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "boarding_pass_parser_strategy" TEXT;



