-- AlterTable
ALTER TABLE "place_list_entries" ADD COLUMN     "created_by" TEXT;

-- AlterTable
ALTER TABLE "place_visits" ADD COLUMN     "created_by" TEXT;

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "brand_wikidata_id" TEXT,
ADD COLUMN     "created_by" TEXT;

-- CreateTable
CREATE TABLE "place_list_brand_rules" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_wikidata_id" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "min_dwell_minutes" INTEGER NOT NULL DEFAULT 5,
    "max_dwell_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_distance_m" INTEGER NOT NULL DEFAULT 60,
    "auto_accept" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_list_brand_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "place_list_brand_rules_user_id_idx" ON "place_list_brand_rules"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_list_brand_rules_list_id_brand_wikidata_id_key" ON "place_list_brand_rules"("list_id", "brand_wikidata_id");

-- AddForeignKey
ALTER TABLE "place_list_brand_rules" ADD CONSTRAINT "place_list_brand_rules_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "place_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_list_brand_rules" ADD CONSTRAINT "place_list_brand_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
