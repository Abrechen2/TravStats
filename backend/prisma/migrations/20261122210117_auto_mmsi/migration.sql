-- AlterTable
ALTER TABLE "cruises" ADD COLUMN     "vessel_mmsi" TEXT,
ADD COLUMN     "vessel_mmsi_source" TEXT;

-- AlterTable
ALTER TABLE "ferry_journeys" ADD COLUMN     "vessel_mmsi_source" TEXT;

-- AlterTable
ALTER TABLE "ships" ADD COLUMN     "mmsi" TEXT;

-- CreateTable
CREATE TABLE "vessel_identities" (
    "lookup_key" TEXT NOT NULL,
    "mmsi" TEXT,
    "imo" TEXT,
    "vessel_name" TEXT,
    "source" TEXT,
    "confidence" TEXT,
    "reason" TEXT,
    "candidates" JSONB,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_identities_pkey" PRIMARY KEY ("lookup_key")
);

-- CreateTable
CREATE TABLE "vessel_position_fixes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ferry_journey_id" TEXT,
    "cruise_id" TEXT,
    "mmsi" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "speed_knots" DOUBLE PRECISION,
    "course_degrees" DOUBLE PRECISION,

    CONSTRAINT "vessel_position_fixes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vessel_position_fixes_user_id_idx" ON "vessel_position_fixes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_position_fixes_ferry_journey_id_observed_at_key" ON "vessel_position_fixes"("ferry_journey_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_position_fixes_cruise_id_observed_at_key" ON "vessel_position_fixes"("cruise_id", "observed_at");

-- AddForeignKey
ALTER TABLE "vessel_position_fixes" ADD CONSTRAINT "vessel_position_fixes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_position_fixes" ADD CONSTRAINT "vessel_position_fixes_ferry_journey_id_fkey" FOREIGN KEY ("ferry_journey_id") REFERENCES "ferry_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_position_fixes" ADD CONSTRAINT "vessel_position_fixes_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
