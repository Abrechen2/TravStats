-- CreateTable
CREATE TABLE "trip_link_proposals" (
    "id" TEXT NOT NULL,
    "proposer_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "linked_trip_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "trip_link_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_link_proposals_recipient_id_status_idx" ON "trip_link_proposals"("recipient_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trip_link_proposals_trip_id_recipient_id_key" ON "trip_link_proposals"("trip_id", "recipient_id");

-- AddForeignKey
ALTER TABLE "trip_link_proposals" ADD CONSTRAINT "trip_link_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_link_proposals" ADD CONSTRAINT "trip_link_proposals_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_link_proposals" ADD CONSTRAINT "trip_link_proposals_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
