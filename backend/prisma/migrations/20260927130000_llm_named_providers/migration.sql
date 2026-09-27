-- beta.18: four NAMED cloud provider slots (openai/anthropic/google/custom),
-- each with its OWN consent, plus a fallback-chain priority among them.
-- Replaces the single admin-picked "active provider" (`llm_provider`) and
-- its one blanket `llm_cloud_opt_in` from beta.17.

-- New columns. Consent defaults to false for every slot — granting one
-- provider never silently grants another.
ALTER TABLE "admin_settings" ADD COLUMN "llm_ollama_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "admin_settings" ADD COLUMN "llm_provider_order" TEXT NOT NULL DEFAULT 'openai,anthropic,google,custom';
ALTER TABLE "admin_settings" ADD COLUMN "llm_custom_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "admin_settings" ADD COLUMN "llm_openai_api_key" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "llm_openai_model" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "llm_openai_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "admin_settings" ADD COLUMN "llm_anthropic_api_key" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "llm_anthropic_model" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "llm_anthropic_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "admin_settings" ADD COLUMN "llm_google_api_key" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "llm_google_model" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "llm_google_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- Data migration: the beta.17 single cloud consent only ever gated the
-- OpenAI-compatible slot (`openai_compat_*`, now the "custom" slot's own
-- config, kept verbatim under its beta.17 column names) — so it maps onto
-- that slot's own consent and nowhere else. An instance that had configured
-- and consented to `openai_compatible` keeps working unchanged; the three
-- newly-named slots (openai/anthropic/google) start unconsented, because
-- nobody has told THIS instance to trust those specific companies yet.
UPDATE "admin_settings" SET "llm_custom_opt_in" = "llm_cloud_opt_in";

-- The old single-selection column is gone: dispatch is now a fallback chain,
-- not one admin-picked "active" kind, so there is nothing left to select.
ALTER TABLE "admin_settings" DROP COLUMN "llm_cloud_opt_in";
ALTER TABLE "admin_settings" DROP COLUMN "llm_provider";
