-- CreateTable
CREATE TABLE "photo_journeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "photo_count" INTEGER NOT NULL,
    "located_count" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "country_code" TEXT,
    "country_name" TEXT,
    "city" TEXT,
    "preview_asset_ids" TEXT[],
    "fingerprint" TEXT NOT NULL,
    "created_trip_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photo_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photo_journeys_user_id_fingerprint_key" ON "photo_journeys"("user_id", "fingerprint");

-- CreateIndex
CREATE INDEX "photo_journeys_user_id_status_idx" ON "photo_journeys"("user_id", "status");

-- CreateIndex
CREATE INDEX "photo_journeys_start_date_idx" ON "photo_journeys"("start_date");

-- AddForeignKey
ALTER TABLE "photo_journeys" ADD CONSTRAINT "photo_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
