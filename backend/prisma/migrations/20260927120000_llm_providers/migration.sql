-- LLM provider choice (beta.17 item 7): Ollama stays the default; an
-- OpenAI-compatible endpoint is opt-in, and a cloud one needs explicit consent.
ALTER TABLE "admin_settings" ADD COLUMN "llm_provider" TEXT NOT NULL DEFAULT 'ollama';
ALTER TABLE "admin_settings" ADD COLUMN "openai_compat_base_url" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "openai_compat_model" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "openai_compat_api_key" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "llm_cloud_opt_in" BOOLEAN NOT NULL DEFAULT false;
