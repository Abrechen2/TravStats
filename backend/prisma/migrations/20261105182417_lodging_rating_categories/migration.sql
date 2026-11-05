-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "ratings" JSONB;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "lodging_rating_categories" TEXT[] DEFAULT ARRAY['room', 'breakfast', 'service']::TEXT[];

-- CreateTable
CREATE TABLE "lodging_rating_categories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_rating_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lodging_rating_categories_user_id_idx" ON "lodging_rating_categories"("user_id");

-- AddForeignKey
ALTER TABLE "lodging_rating_categories" ADD CONSTRAINT "lodging_rating_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataBackfill: carry the three existing category columns into the new map.
-- The columns stay in place (and are mirrored on write) so a rollback loses
-- nothing. jsonb_strip_nulls drops the blank ones: an absent key means
-- "not rated", never zero. Stays with no component rating keep NULL.
UPDATE "lodging_stays"
SET "ratings" = jsonb_strip_nulls(jsonb_build_object(
  'room', "rating_room",
  'breakfast', "rating_breakfast",
  'service', "rating_service"
))
WHERE "rating_room" IS NOT NULL
   OR "rating_breakfast" IS NOT NULL
   OR "rating_service" IS NOT NULL;
