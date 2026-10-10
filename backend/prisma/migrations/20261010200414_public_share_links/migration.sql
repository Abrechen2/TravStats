-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "share_links_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public_share_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "flight_id" TEXT,
    "trip_id" TEXT,
    "year" INTEGER,
    "fields" TEXT[],
    "photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_share_links_token_hash_key" ON "public_share_links"("token_hash");

-- CreateIndex
CREATE INDEX "public_share_links_user_id_idx" ON "public_share_links"("user_id");

-- CreateIndex
CREATE INDEX "public_share_links_flight_id_idx" ON "public_share_links"("flight_id");

-- CreateIndex
CREATE INDEX "public_share_links_trip_id_idx" ON "public_share_links"("trip_id");

-- AddForeignKey
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
