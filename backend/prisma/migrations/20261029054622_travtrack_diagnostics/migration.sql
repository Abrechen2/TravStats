-- CreateTable
CREATE TABLE "travtrack_diagnostic_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "t" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_diagnostic_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_diagnostic_uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "device" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_diagnostic_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travtrack_diagnostic_events_user_id_t_idx" ON "travtrack_diagnostic_events"("user_id", "t");

-- CreateIndex
CREATE INDEX "travtrack_diagnostic_events_t_idx" ON "travtrack_diagnostic_events"("t");

-- CreateIndex
CREATE INDEX "travtrack_diagnostic_uploads_created_at_idx" ON "travtrack_diagnostic_uploads"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_diagnostic_uploads_user_id_device_id_upload_id_key" ON "travtrack_diagnostic_uploads"("user_id", "device_id", "upload_id");

-- AddForeignKey
ALTER TABLE "travtrack_diagnostic_events" ADD CONSTRAINT "travtrack_diagnostic_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_diagnostic_uploads" ADD CONSTRAINT "travtrack_diagnostic_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
