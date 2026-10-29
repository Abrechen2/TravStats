-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "aeroapi_custom_budget_usd" DOUBLE PRECISION,
ADD COLUMN     "aeroapi_tier" TEXT NOT NULL DEFAULT 'personal',
ADD COLUMN     "aeroapi_tracks_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "aeroapi_usage" (
    "month" TEXT NOT NULL,
    "spent_milli_usd" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aeroapi_usage_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "aeroapi_track_attempts" (
    "flight_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aeroapi_track_attempts_pkey" PRIMARY KEY ("flight_id")
);

-- AddForeignKey
ALTER TABLE "aeroapi_track_attempts" ADD CONSTRAINT "aeroapi_track_attempts_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
