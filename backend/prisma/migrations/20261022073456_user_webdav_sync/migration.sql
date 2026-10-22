-- CreateTable
CREATE TABLE "user_webdav_syncs" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "username" TEXT,
    "password_encrypted" TEXT,
    "remote_path" TEXT NOT NULL DEFAULT '/TravStats/',
    "schedule" TEXT NOT NULL DEFAULT 'daily',
    "keep_versions" INTEGER NOT NULL DEFAULT 5,
    "last_attempt_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_error_code" TEXT,
    "last_file_name" TEXT,
    "last_size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_webdav_syncs_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_webdav_syncs" ADD CONSTRAINT "user_webdav_syncs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
