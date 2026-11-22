-- AlterTable
ALTER TABLE "bus_journeys" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "cruises" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "ferry_journeys" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "place_visits" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "remembered_note" TEXT,
ADD COLUMN     "remembered_on" DATE;

-- CreateTable
CREATE TABLE "provenance_notices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entry_type" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "content_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provenance_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provenance_notices_user_id_status_idx" ON "provenance_notices"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provenance_notices_user_id_content_key_key" ON "provenance_notices"("user_id", "content_key");

-- AddForeignKey
ALTER TABLE "provenance_notices" ADD CONSTRAINT "provenance_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A provenance is one of two words or unknown, and the recollection's date and note belong to
-- `remembered` only (spec 2026-11-22-remembered-facts).
ALTER TABLE "trips" ADD CONSTRAINT "trips_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "flights" ADD CONSTRAINT "flights_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "bus_journeys" ADD CONSTRAINT "bus_journeys_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
ALTER TABLE "place_visits" ADD CONSTRAINT "place_visits_provenance_check" CHECK (
  ("provenance" IS NULL OR "provenance" IN ('recorded', 'remembered'))
  AND ("provenance" = 'remembered' OR ("remembered_on" IS NULL AND "remembered_note" IS NULL))
);
