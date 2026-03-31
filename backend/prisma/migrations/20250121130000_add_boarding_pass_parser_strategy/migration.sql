-- Add boarding_pass_parser_strategy to user_settings
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_settings') THEN
        ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "boarding_pass_parser_strategy" TEXT;
    END IF;
END $$;
