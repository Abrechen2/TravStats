-- CreateTable: System settings for instance-wide configuration
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);
