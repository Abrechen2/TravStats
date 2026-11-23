-- AlterTable
ALTER TABLE "ferry_journeys" ADD COLUMN     "manual_scope" TEXT;

-- CreateTable
CREATE TABLE "ferry_pair_routes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "a_name" TEXT NOT NULL,
    "a_lat" DOUBLE PRECISION NOT NULL,
    "a_lon" DOUBLE PRECISION NOT NULL,
    "b_name" TEXT NOT NULL,
    "b_lat" DOUBLE PRECISION NOT NULL,
    "b_lon" DOUBLE PRECISION NOT NULL,
    "waypoints" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ferry_pair_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ferry_pair_routes_user_id_idx" ON "ferry_pair_routes"("user_id");

-- AddForeignKey
ALTER TABLE "ferry_pair_routes" ADD CONSTRAINT "ferry_pair_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
