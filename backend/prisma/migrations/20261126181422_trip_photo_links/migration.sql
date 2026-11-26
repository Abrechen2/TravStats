-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "photo_period_auto_link" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "trip_photo_periods" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "from_day" DATE,
    "until_day" DATE,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_photo_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_photo_proposal_dismissals" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "album_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_photo_proposal_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trip_photo_periods_trip_id_provider_key" ON "trip_photo_periods"("trip_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "trip_photo_proposal_dismissals_trip_id_provider_album_id_key" ON "trip_photo_proposal_dismissals"("trip_id", "provider", "album_id");

-- AddForeignKey
ALTER TABLE "trip_photo_periods" ADD CONSTRAINT "trip_photo_periods_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_photo_proposal_dismissals" ADD CONSTRAINT "trip_photo_proposal_dismissals_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
