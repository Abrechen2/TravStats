-- CreateTable
CREATE TABLE "place_visit_photos" (
    "id" TEXT NOT NULL,
    "place_visit_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "caption" TEXT,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "immich_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_visit_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_lists" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#5ec2b2',
    "icon" TEXT,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "curated_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_list_entries" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curated_lists" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "description_en" TEXT,
    "icon" TEXT,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "curated_lists_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "curated_places" (
    "id" TEXT NOT NULL,
    "list_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "blurb" TEXT,
    "blurb_en" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "country" TEXT,
    "iso_country_code" TEXT,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "curated_places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "place_visit_photos_place_visit_id_idx" ON "place_visit_photos"("place_visit_id");

-- CreateIndex
CREATE INDEX "place_lists_user_id_idx" ON "place_lists"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_lists_user_id_curated_key_key" ON "place_lists"("user_id", "curated_key");

-- CreateIndex
CREATE INDEX "place_list_entries_list_id_idx" ON "place_list_entries"("list_id");

-- CreateIndex
CREATE INDEX "place_list_entries_place_id_idx" ON "place_list_entries"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_list_entries_list_id_place_id_key" ON "place_list_entries"("list_id", "place_id");

-- CreateIndex
CREATE INDEX "curated_places_list_key_idx" ON "curated_places"("list_key");

-- AddForeignKey
ALTER TABLE "place_visit_photos" ADD CONSTRAINT "place_visit_photos_place_visit_id_fkey" FOREIGN KEY ("place_visit_id") REFERENCES "place_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_lists" ADD CONSTRAINT "place_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_list_entries" ADD CONSTRAINT "place_list_entries_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "place_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_list_entries" ADD CONSTRAINT "place_list_entries_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curated_places" ADD CONSTRAINT "curated_places_list_key_fkey" FOREIGN KEY ("list_key") REFERENCES "curated_lists"("key") ON DELETE CASCADE ON UPDATE CASCADE;
