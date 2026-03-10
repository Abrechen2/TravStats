-- AlterTable: Add notification fields to users
ALTER TABLE "users" ADD COLUMN "notification_email" TEXT;
ALTER TABLE "users" ADD COLUMN "notify_before_24h" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "notify_before_2h" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: SmtpConfig
CREATE TABLE "smtp_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 587,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "from_name" TEXT NOT NULL DEFAULT 'TravStats',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smtp_config_pkey" PRIMARY KEY ("id")
);
