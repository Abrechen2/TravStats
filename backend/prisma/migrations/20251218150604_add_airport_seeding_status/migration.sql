-- CreateTable
CREATE TABLE "airport_seeding_status" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "total_airports" INTEGER NOT NULL DEFAULT 0,
    "processed_airports" INTEGER NOT NULL DEFAULT 0,
    "estimated_time_remaining" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airport_seeding_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "airport_seeding_status_status_idx" ON "airport_seeding_status"("status");











