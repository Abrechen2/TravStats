-- CreateTable
CREATE TABLE "cruise_tracks" (
    "id" TEXT NOT NULL,
    "cruise_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "geometry" JSONB NOT NULL,
    "segment_starts" JSONB NOT NULL,
    "cumulative_km" JSONB NOT NULL,
    "point_count" INTEGER NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "external_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cruise_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cruise_tracks_cruise_id_idx" ON "cruise_tracks"("cruise_id");

-- CreateIndex
CREATE UNIQUE INDEX "cruise_tracks_cruise_id_external_ref_key" ON "cruise_tracks"("cruise_id", "external_ref");

-- AddForeignKey
ALTER TABLE "cruise_tracks" ADD CONSTRAINT "cruise_tracks_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
