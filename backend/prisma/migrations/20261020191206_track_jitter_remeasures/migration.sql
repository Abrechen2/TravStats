-- CreateTable
CREATE TABLE "track_jitter_remeasures" (
    "id" TEXT NOT NULL,
    "route_track_id" TEXT,
    "cruise_track_id" TEXT,
    "user_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3),
    "previous" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_jitter_remeasures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "track_jitter_remeasures_route_track_id_key" ON "track_jitter_remeasures"("route_track_id");

-- CreateIndex
CREATE UNIQUE INDEX "track_jitter_remeasures_cruise_track_id_key" ON "track_jitter_remeasures"("cruise_track_id");

-- CreateIndex
CREATE INDEX "track_jitter_remeasures_user_id_idx" ON "track_jitter_remeasures"("user_id");

-- AddForeignKey
ALTER TABLE "track_jitter_remeasures" ADD CONSTRAINT "track_jitter_remeasures_route_track_id_fkey" FOREIGN KEY ("route_track_id") REFERENCES "trip_route_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_jitter_remeasures" ADD CONSTRAINT "track_jitter_remeasures_cruise_track_id_fkey" FOREIGN KEY ("cruise_track_id") REFERENCES "cruise_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_jitter_remeasures" ADD CONSTRAINT "track_jitter_remeasures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
