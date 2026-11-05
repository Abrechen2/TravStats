-- CreateTable
CREATE TABLE "travtrack_fixed_places" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL,
    "window" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travtrack_fixed_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_place_settings" (
    "user_id" TEXT NOT NULL,
    "home_radius_m" INTEGER NOT NULL DEFAULT 150,
    "home_window" JSONB,
    "lodging_enabled" BOOLEAN NOT NULL DEFAULT false,
    "lodging_radius_m" INTEGER NOT NULL DEFAULT 150,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travtrack_place_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "travtrack_fixed_places_user_id_idx" ON "travtrack_fixed_places"("user_id");

-- AddForeignKey
ALTER TABLE "travtrack_fixed_places" ADD CONSTRAINT "travtrack_fixed_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_place_settings" ADD CONSTRAINT "travtrack_place_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
