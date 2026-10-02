-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "global_aeroapi_api_key" TEXT,
ADD COLUMN     "push_consent_at" TIMESTAMP(3),
ADD COLUMN     "push_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "push_instance_id" TEXT,
ADD COLUMN     "push_instance_secret" TEXT,
ADD COLUMN     "push_paused_until" TIMESTAMP(3),
ADD COLUMN     "push_relay_url" TEXT NOT NULL DEFAULT 'https://push.travstats.de';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "aeroapi_api_key" TEXT;

-- CreateTable
CREATE TABLE "device_push" (
    "api_token_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "apns_environment" TEXT,
    "public_key" TEXT NOT NULL,
    "flight_changes" BOOLEAN NOT NULL DEFAULT true,
    "reminders" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'de',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_push_pkey" PRIMARY KEY ("api_token_id")
);

-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" TEXT NOT NULL,
    "api_token_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_push_user_id_idx" ON "device_push"("user_id");

-- CreateIndex
CREATE INDEX "push_deliveries_sent_at_idx" ON "push_deliveries"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_deliveries_api_token_id_event_key_key" ON "push_deliveries"("api_token_id", "event_key");

-- AddForeignKey
ALTER TABLE "device_push" ADD CONSTRAINT "device_push_api_token_id_fkey" FOREIGN KEY ("api_token_id") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push" ADD CONSTRAINT "device_push_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_api_token_id_fkey" FOREIGN KEY ("api_token_id") REFERENCES "device_push"("api_token_id") ON DELETE CASCADE ON UPDATE CASCADE;
