-- CreateTable
CREATE TABLE "trip_suggestion_decisions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target_id" TEXT,
    "member_keys" TEXT[],
    "created_trip_id" TEXT,
    "created_place_visit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_suggestion_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_suggestion_decisions_user_id_status_idx" ON "trip_suggestion_decisions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trip_suggestion_decisions_user_id_fingerprint_key" ON "trip_suggestion_decisions"("user_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "trip_suggestion_decisions" ADD CONSTRAINT "trip_suggestion_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
