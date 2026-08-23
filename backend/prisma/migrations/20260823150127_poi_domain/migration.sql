-- CreateTable
CREATE TABLE "places" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "iso_country_code" TEXT,
    "external_ref" TEXT,
    "curated_item_id" TEXT,
    "visited" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "data_source" TEXT,
    "batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_visits" (
    "id" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "visited_at" TIMESTAMP(3),
    "order_idx" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "rating" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "places_user_id_idx" ON "places"("user_id");

-- CreateIndex
CREATE INDEX "places_user_id_category_idx" ON "places"("user_id", "category");

-- CreateIndex
CREATE INDEX "places_user_id_visited_idx" ON "places"("user_id", "visited");

-- CreateIndex
CREATE UNIQUE INDEX "places_user_id_external_ref_key" ON "places"("user_id", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "places_user_id_curated_item_id_key" ON "places"("user_id", "curated_item_id");

-- CreateIndex
CREATE INDEX "place_visits_user_id_idx" ON "place_visits"("user_id");

-- CreateIndex
CREATE INDEX "place_visits_place_id_idx" ON "place_visits"("place_id");

-- CreateIndex
CREATE INDEX "place_visits_trip_id_idx" ON "place_visits"("trip_id");

-- CreateIndex
CREATE INDEX "place_visits_user_id_visited_at_idx" ON "place_visits"("user_id", "visited_at");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_visits" ADD CONSTRAINT "place_visits_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_visits" ADD CONSTRAINT "place_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_visits" ADD CONSTRAINT "place_visits_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
