-- CreateTable
CREATE TABLE "ferry_route_backfills" (
    "ferry_journey_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "ferry_route_backfills_pkey" PRIMARY KEY ("ferry_journey_id")
);

-- CreateIndex
CREATE INDEX "ferry_route_backfills_next_attempt_at_idx" ON "ferry_route_backfills"("next_attempt_at");

-- AddForeignKey
ALTER TABLE "ferry_route_backfills" ADD CONSTRAINT "ferry_route_backfills_ferry_journey_id_fkey" FOREIGN KEY ("ferry_journey_id") REFERENCES "ferry_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
