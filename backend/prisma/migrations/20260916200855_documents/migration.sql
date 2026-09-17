-- forgejo#116: kept originals, filed with the entry they produced.
-- A document belongs to at most ONE entry; none means "uploaded, not yet filed".

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stored_name" TEXT NOT NULL,
    "original_name" TEXT,
    "mimetype" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "kind" TEXT,
    "issued_on" DATE,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "parsed_domain" TEXT,
    "parsed_payload" JSONB,
    "flight_id" TEXT,
    "cruise_id" TEXT,
    "lodging_stay_id" TEXT,
    "trip_id" TEXT,
    "place_visit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_user_id_sha256_idx" ON "documents"("user_id", "sha256");

-- CreateIndex
CREATE INDEX "documents_flight_id_idx" ON "documents"("flight_id");

-- CreateIndex
CREATE INDEX "documents_cruise_id_idx" ON "documents"("cruise_id");

-- CreateIndex
CREATE INDEX "documents_lodging_stay_id_idx" ON "documents"("lodging_stay_id");

-- CreateIndex
CREATE INDEX "documents_trip_id_idx" ON "documents"("trip_id");

-- CreateIndex
CREATE INDEX "documents_place_visit_id_idx" ON "documents"("place_visit_id");

-- CreateIndex
CREATE INDEX "documents_user_id_linked_at_idx" ON "documents"("user_id", "linked_at");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_lodging_stay_id_fkey" FOREIGN KEY ("lodging_stay_id") REFERENCES "lodging_stays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_place_visit_id_fkey" FOREIGN KEY ("place_visit_id") REFERENCES "place_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one owner. Prisma cannot express a CHECK, so it lives here; the
-- application enforces the same rule before it writes (services/documents).
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id") <= 1
);
