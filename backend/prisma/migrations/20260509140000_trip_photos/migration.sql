-- Trip photo gallery (iter 7).
-- Hand-written to stay consistent with the other cruise/trip migrations
-- which avoid prisma migrate dev because of pre-existing schema drift.

CREATE TABLE "trip_photos" (
  "id"         TEXT PRIMARY KEY,
  "trip_id"    TEXT NOT NULL,
  "filename"   TEXT NOT NULL,
  "mimetype"   TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "caption"    TEXT,
  "taken_at"   TIMESTAMP(3),
  "sort_idx"   INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trip_photos_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "trip_photos_trip_id_idx" ON "trip_photos"("trip_id");
CREATE INDEX "trip_photos_trip_id_sort_idx" ON "trip_photos"("trip_id", "sort_idx");
