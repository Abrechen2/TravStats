-- CreateTable
CREATE TABLE "place_external_refs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "place_external_refs_place_id_idx" ON "place_external_refs"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_external_refs_user_id_ref_key" ON "place_external_refs"("user_id", "ref");

-- AddForeignKey
ALTER TABLE "place_external_refs" ADD CONSTRAINT "place_external_refs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_external_refs" ADD CONSTRAINT "place_external_refs_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
