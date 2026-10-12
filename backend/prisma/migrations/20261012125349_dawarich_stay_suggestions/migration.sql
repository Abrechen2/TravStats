-- CreateTable
CREATE TABLE "dawarich_stay_scans" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "result" TEXT,
    "error" TEXT,
    "data_through" TIMESTAMP(3),
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "point_count" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dawarich_stay_scans_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "dawarich_stays" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source_start_at" TIMESTAMP(3) NOT NULL,
    "source_end_at" TIMESTAMP(3) NOT NULL,
    "source_lat" DOUBLE PRECISION NOT NULL,
    "source_lon" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "zone" TEXT NOT NULL,
    "point_count" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "place_id" TEXT,
    "trip_id" TEXT,
    "name" TEXT,
    "visit_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "dawarich_stays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dawarich_stays_user_id_status_start_at_idx" ON "dawarich_stays"("user_id", "status", "start_at");

-- CreateIndex
CREATE INDEX "dawarich_stays_visit_id_idx" ON "dawarich_stays"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "dawarich_stays_user_id_fingerprint_key" ON "dawarich_stays"("user_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "dawarich_stay_scans" ADD CONSTRAINT "dawarich_stay_scans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dawarich_stays" ADD CONSTRAINT "dawarich_stays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dawarich_stays" ADD CONSTRAINT "dawarich_stays_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "place_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
