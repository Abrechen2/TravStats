-- CreateTable
CREATE TABLE "visit_photo_refusals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "place_visit_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "suggestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_photo_refusals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_photo_refusals_user_id_idx" ON "visit_photo_refusals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_photo_refusals_place_visit_id_kind_suggestion_id_key" ON "visit_photo_refusals"("place_visit_id", "kind", "suggestion_id");

-- AddForeignKey
ALTER TABLE "visit_photo_refusals" ADD CONSTRAINT "visit_photo_refusals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_photo_refusals" ADD CONSTRAINT "visit_photo_refusals_place_visit_id_fkey" FOREIGN KEY ("place_visit_id") REFERENCES "place_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
