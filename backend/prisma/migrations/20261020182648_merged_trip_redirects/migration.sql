-- CreateTable
CREATE TABLE "merged_trip_redirects" (
    "source_trip_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merged_into_trip_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merged_trip_redirects_pkey" PRIMARY KEY ("source_trip_id")
);

-- CreateIndex
CREATE INDEX "merged_trip_redirects_merged_into_trip_id_idx" ON "merged_trip_redirects"("merged_into_trip_id");

-- AddForeignKey
ALTER TABLE "merged_trip_redirects" ADD CONSTRAINT "merged_trip_redirects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merged_trip_redirects" ADD CONSTRAINT "merged_trip_redirects_merged_into_trip_id_fkey" FOREIGN KEY ("merged_into_trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
