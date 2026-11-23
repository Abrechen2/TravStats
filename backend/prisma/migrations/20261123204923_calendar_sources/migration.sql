-- CreateTable
CREATE TABLE "calendar_sources" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ics_url_encrypted" TEXT,
    "ics_host" TEXT,
    "caldav_url" TEXT,
    "caldav_username" TEXT,
    "caldav_password_encrypted" TEXT,
    "caldav_collections" JSONB NOT NULL DEFAULT '[]',
    "last_status" TEXT,
    "last_error_code" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_sources_user_id_idx" ON "calendar_sources"("user_id");

-- AddForeignKey
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
