-- CreateTable
CREATE TABLE "place_captures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "place_id" TEXT,
    "visit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_captures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "place_captures_user_id_status_captured_at_idx" ON "place_captures"("user_id", "status", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "place_captures_user_id_client_id_key" ON "place_captures"("user_id", "client_id");

-- AddForeignKey
ALTER TABLE "place_captures" ADD CONSTRAINT "place_captures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_captures" ADD CONSTRAINT "place_captures_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_captures" ADD CONSTRAINT "place_captures_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "place_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
