-- AlterTable
ALTER TABLE "system_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "claude_api_key" TEXT,
ADD COLUMN     "openai_api_key" TEXT,
ADD COLUMN     "preferred_text_parser" TEXT DEFAULT 'auto',
ADD COLUMN     "preferred_vision_parser" TEXT DEFAULT 'auto',
ADD COLUMN     "text_fallback_chain" TEXT DEFAULT 'ollama,openai,claude,regex',
ADD COLUMN     "vision_fallback_chain" TEXT DEFAULT 'ollama,openai,claude,tesseract,manual';

-- CreateTable
CREATE TABLE "admin_settings" (
    "id" SERIAL NOT NULL,
    "global_openai_api_key" TEXT,
    "global_claude_api_key" TEXT,
    "allow_user_api_keys" BOOLEAN NOT NULL DEFAULT true,
    "require_user_api_keys" BOOLEAN NOT NULL DEFAULT false,
    "default_vision_parser" TEXT NOT NULL DEFAULT 'auto',
    "default_text_parser" TEXT NOT NULL DEFAULT 'auto',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);
