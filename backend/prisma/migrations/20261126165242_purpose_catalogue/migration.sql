-- AlterTable
ALTER TABLE "bus_journeys" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "cruises" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "ferry_journeys" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "place_visits" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "purpose_key" TEXT;

-- AlterTable
ALTER TABLE "trip_routes" ADD COLUMN     "purpose_key" TEXT;

-- CreateTable
CREATE TABLE "custom_purposes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "kind" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_purposes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_purposes_user_id_idx" ON "custom_purposes"("user_id");

-- AddForeignKey
ALTER TABLE "custom_purposes" ADD CONSTRAINT "custom_purposes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Checks Prisma cannot express (as in 20261122162555_purpose_flag): a detailed key is builtin:<key>
-- or custom:<uuid>, and it only ever stands beside a kind.
ALTER TABLE "bus_journeys" ADD CONSTRAINT "bus_journeys_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "flights" ADD CONSTRAINT "flights_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "place_visits" ADD CONSTRAINT "place_visits_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "trip_routes" ADD CONSTRAINT "trip_routes_purpose_key_check" CHECK ("purpose_key" IS NULL OR ("purpose" IS NOT NULL AND "purpose_key" ~ '^(builtin:[a-z_]+|custom:[0-9a-f-]{36})$'));
ALTER TABLE "custom_purposes" ADD CONSTRAINT "custom_purposes_kind_check" CHECK ("kind" IN ('private', 'business'));
